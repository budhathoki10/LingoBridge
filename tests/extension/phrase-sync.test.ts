import type { SyncRequest, SyncResponse } from "@lingobridge/contracts/account";
import {
  type Database,
  deletePhrases,
  openInMemoryDatabase,
  runSync,
  updatePhraseNote,
} from "@lingobridge/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountClientError, type AccountClient } from "../../apps/extension/lib/account-client";
import {
  ACCOUNT_STATUS_STORAGE_KEY,
  normalizeAccountStatus,
  SYNC_STATE_STORAGE_KEY,
} from "../../apps/extension/lib/account-status";
import {
  applySyncResponse,
  buildSyncRequest,
  INITIAL_SYNC_STATE,
  MAX_OUTBOX,
  normalizeSyncState,
  queueLocalChanges,
  scheduleRetry,
  type SyncState,
} from "../../apps/extension/lib/phrase-sync";
import {
  MAX_SAVED_PHRASES,
  SAVED_PHRASES_STORAGE_KEY,
  type SavedPhrase,
} from "../../apps/extension/lib/saved-phrases";
import {
  createSyncService,
  POPUP_PREFERENCES_STORAGE_KEY,
} from "../../apps/extension/lib/sync-service";
import { createUser } from "../support/account-fixtures";

const NOW = new Date("2026-09-14T10:00:00.000Z");
let database: Database;
let userId: string;
let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

function local(id: string, overrides: Partial<SavedPhrase> = {}): SavedPhrase {
  return {
    id,
    provider: "nvidia",
    savedAt: "2026-09-14T09:00:00.000Z",
    sourceLanguage: "en",
    sourceText: `Source ${id}`,
    targetLanguage: "ne",
    translatedText: `अनुवाद ${id}`,
    ...overrides,
  };
}

/** One simulated device: its local phrases, its sync state, and a round trip against the real server. */
class Device {
  phrases: SavedPhrase[] = [];
  state: SyncState = INITIAL_SYNC_STATE;
  target: string | null = "ne";
  offline = false;
  loseNextResponse = false;

  async sync(): Promise<SyncResponse | null> {
    this.state = queueLocalChanges(this.state, this.phrases, this.target, newId);
    const request: SyncRequest = buildSyncRequest(this.state);
    if (this.offline) {
      this.state = scheduleRetry(this.state, NOW, "offline", () => 0.5);
      return null;
    }
    const response = await runSync(database, userId, request, NOW);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      this.state = scheduleRetry(this.state, NOW, "lost", () => 0.5);
      return null;
    }
    const applied = applySyncResponse(this.state, this.phrases, request, response, NOW, newId);
    this.phrases = applied.phrases;
    this.state = applied.state;
    if (applied.preferredTargetLanguage) this.target = applied.preferredTargetLanguage;
    return response;
  }

  async syncUntilSettled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
      const response = await this.sync();
      const pending = queueLocalChanges(this.state, this.phrases, this.target, () => "probe").outbox
        .length;
      if (response && !response.hasMore && pending === 0) return;
    }
  }
}

beforeEach(async () => {
  database = await openInMemoryDatabase();
  userId = (await createUser(database, "device@example.test", NOW)).id;
});

afterEach(async () => {
  await database.close();
});

describe("local-first queueing", () => {
  it("queues saves and deletions, coalescing repeated edits to one mutation per phrase", () => {
    let state: SyncState = {
      ...INITIAL_SYNC_STATE,
      known: { gone: { fingerprint: "x", revision: 3 } },
    };
    state = queueLocalChanges(state, [local("a")], "ne", newId);
    state = queueLocalChanges(state, [local("a", { note: "edited" })], "ne", newId);
    expect(state.outbox.map((mutation) => mutation.kind)).toEqual([
      "delete-phrase",
      "upsert-phrase",
    ]);
    expect(state.outbox.find((mutation) => mutation.kind === "delete-phrase")).toMatchObject({
      baseRevision: 3,
      phraseId: "gone",
    });
    expect(state.outbox.find((mutation) => mutation.kind === "upsert-phrase")).toMatchObject({
      baseRevision: 0,
      phrase: { note: "edited" },
    });
  });

  it("keeps the same mutation id across retries so the server can deduplicate", () => {
    const first = queueLocalChanges(INITIAL_SYNC_STATE, [local("a")], "ne", newId);
    const retried = queueLocalChanges(first, [local("a")], "ne", newId);
    expect(retried.outbox).toEqual(first.outbox);
  });

  it("bounds the outbox and discards stored mutations that no longer match the contract", () => {
    const many = Array.from({ length: MAX_OUTBOX + 20 }, (_, index) => local(`p${index}`));
    expect(queueLocalChanges(INITIAL_SYNC_STATE, many, "ne", newId).outbox.length).toBe(MAX_OUTBOX);
    const restored = normalizeSyncState({
      outbox: [{ kind: "upsert-phrase", phrase: { id: "bad" } }, { kind: "nonsense" }],
    });
    expect(restored.outbox).toEqual([]);
  });

  it("backs off exponentially with a cap", () => {
    let state = INITIAL_SYNC_STATE;
    const delays: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      state = scheduleRetry(state, NOW, "offline", () => 0.5);
      delays.push(Date.parse(state.nextAttemptAt ?? "") - NOW.getTime());
    }
    expect(delays.slice(0, 4)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(Math.max(...delays)).toBe(30 * 60_000);
    expect(state.failures).toBe(10);
  });
});

describe("synchronization against the server", () => {
  it("retries offline changes and applies each exactly once", async () => {
    const device = new Device();
    device.phrases = [local("offline-1"), local("offline-2")];
    device.offline = true;
    await device.sync();
    await device.sync();
    expect(device.state.failures).toBe(2);
    expect(device.state.outbox).toHaveLength(2);

    device.offline = false;
    await device.syncUntilSettled();
    expect(device.state.outbox).toEqual([]);
    expect(device.state.failures).toBe(0);
    const rows = await database.db
      .collection("phrases")
      .find({}, { projection: { _id: 0, id: 1, revision: 1 }, sort: { id: 1 } })
      .toArray();
    expect(rows).toEqual([
      { id: "offline-1", revision: 1 },
      { id: "offline-2", revision: 1 },
    ]);
  });

  it("is idempotent when the response to an applied request is lost", async () => {
    const device = new Device();
    device.phrases = [local("lost")];
    device.loseNextResponse = true;
    await device.sync();
    expect(device.state.outbox).toHaveLength(1);
    await device.syncUntilSettled();
    const rows = await database.db
      .collection("phrases")
      .find({ id: "lost" }, { projection: { _id: 0, revision: 1 } })
      .toArray();
    expect(rows).toEqual([{ revision: 1 }]);
    expect(device.state.known.lost?.revision).toBe(1);
  });

  it("propagates saves, dashboard edits, and deletions between devices", async () => {
    const laptop = new Device();
    const desktop = new Device();
    laptop.phrases = [local("shared")];
    await laptop.syncUntilSettled();

    await desktop.syncUntilSettled();
    expect(desktop.phrases.map((entry) => entry.id)).toEqual(["shared"]);

    await updatePhraseNote(
      database,
      userId,
      { baseRevision: 1, note: "from the web", phraseId: "shared" },
      NOW,
    );
    await laptop.syncUntilSettled();
    expect(laptop.phrases[0]?.note).toBe("from the web");

    desktop.phrases = [];
    await desktop.syncUntilSettled();
    await laptop.syncUntilSettled();
    expect(laptop.phrases).toEqual([]);
    expect(laptop.state.known).toEqual({});
  });

  it("removes a phrase deleted on the dashboard even if the device had an unsent edit", async () => {
    const device = new Device();
    device.phrases = [local("contested")];
    await device.syncUntilSettled();

    await deletePhrases(database, userId, ["contested"], NOW);
    device.phrases = [local("contested", { note: "offline edit" })];
    await device.syncUntilSettled();

    expect(device.phrases).toEqual([]);
    const row = await database.db.collection("phrases").findOne({ id: "contested" });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("adopts the server version on a stale note edit, and keeps both when content truly differs", async () => {
    const device = new Device();
    device.phrases = [local("note"), local("fork")];
    await device.syncUntilSettled();
    await updatePhraseNote(
      database,
      userId,
      { baseRevision: 1, note: "server note", phraseId: "note" },
      NOW,
    );

    // The device edits the note without having pulled the server change.
    device.phrases = device.phrases.map((entry) =>
      entry.id === "note" ? { ...entry, note: "device note" } : entry,
    );
    const staleRequest = buildSyncRequest(
      queueLocalChanges(device.state, device.phrases, device.target, newId),
    );
    expect(staleRequest.mutations).toHaveLength(1);
    await device.syncUntilSettled();
    expect(device.phrases.find((entry) => entry.id === "note")?.note).toBe("server note");

    // Simulate a content conflict: server content differs from the device's copy of the same id.
    const bumped = await database.db
      .collection<{ _id: string; changeSeq: number }>("users")
      .findOneAndUpdate({ _id: userId }, { $inc: { changeSeq: 1 } }, { returnDocument: "after" });
    await database.db.collection("phrases").updateOne(
      { id: "fork" },
      {
        $inc: { revision: 1 },
        $set: { changeSeq: bumped?.changeSeq, translatedText: "server translation" },
      },
    );
    device.phrases = device.phrases.map((entry) =>
      entry.id === "fork" ? { ...entry, note: "force a push" } : entry,
    );
    const known = device.state.known.fork;
    device.state = {
      ...device.state,
      cursor: device.state.cursor,
      known: {
        ...device.state.known,
        fork: { fingerprint: "stale", revision: known?.revision ?? 1 },
      },
    };
    await device.syncUntilSettled();

    const forks = device.phrases.filter((entry) => entry.sourceText === "Source fork");
    expect(forks.map((entry) => entry.translatedText).sort()).toEqual([
      "server translation",
      "अनुवाद fork",
    ]);
    const serverCopies = await database.db.collection("phrases").countDocuments({
      deletedAt: null,
      sourceText: "Source fork",
    });
    expect(serverCopies).toBe(2);
  });

  it("uploads never-synced local phrases on first connection and prunes phrases deleted while tombstones expired", async () => {
    const device = new Device();
    device.phrases = [local("kept"), local("removed-elsewhere")];
    await device.syncUntilSettled();

    await database.db.collection("phrases").deleteOne({ id: "removed-elsewhere" });
    device.state = { ...device.state, cursor: null };
    device.phrases = [...device.phrases, local("new-local")];
    await device.syncUntilSettled();

    expect(device.phrases.map((entry) => entry.id).sort()).toEqual(["kept", "new-local"]);
  });

  it("synchronizes the preferred language: first device seeds it, later changes win by revision", async () => {
    const first = new Device();
    first.target = "ne";
    await first.syncUntilSettled();
    const stored = await database.db.collection("preferences").findOne({});
    expect(stored?.preferredTargetLanguage).toBe("ne");

    const second = new Device();
    second.target = "en";
    await second.syncUntilSettled();
    expect(second.target).toBe("ne");

    first.target = "hi";
    await first.syncUntilSettled();
    await second.syncUntilSettled();
    expect(second.target).toBe("hi");
  });
});

describe("background sync service", () => {
  function memoryStorage(initial: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = structuredClone(initial);
    return {
      data,
      async get(keys: string[]) {
        return Object.fromEntries(
          keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]),
        );
      },
      async set(items: Record<string, unknown>) {
        Object.assign(data, structuredClone(items));
      },
    };
  }

  function serverClient(overrides: Partial<AccountClient> = {}): AccountClient {
    return {
      disconnect: async () => undefined,
      exchangeCode: async () => {
        throw new Error("unused");
      },
      sync: (request) => runSync(database, userId, request, NOW),
      ...overrides,
    } as AccountClient;
  }

  it("does not delete server phrases that exceed the local storage bound", async () => {
    const total = MAX_SAVED_PHRASES + 25;
    for (let index = 0; index < total; index += 100) {
      await runSync(
        database,
        userId,
        {
          cursor: null,
          mutations: Array.from({ length: Math.min(100, total - index) }, (_, offset) => ({
            baseRevision: 0,
            kind: "upsert-phrase" as const,
            mutationId: crypto.randomUUID(),
            phrase: {
              ...local(`bulk-${index + offset}`, {
                savedAt: new Date(NOW.getTime() - (index + offset) * 1_000).toISOString(),
              }),
              note: null,
              provider: "nvidia" as const,
            },
          })),
        },
        NOW,
      );
    }

    const storage = memoryStorage({ [ACCOUNT_STATUS_STORAGE_KEY]: { connection: "connected" } });
    const service = createSyncService({
      client: serverClient(),
      hasCredentials: async () => true,
      newId,
      now: () => NOW,
      scheduleAt: async () => undefined,
      storage,
    });
    await expect(service.run()).resolves.toBe("synced");
    await expect(service.run()).resolves.toBe("synced");

    expect((storage.data[SAVED_PHRASES_STORAGE_KEY] as unknown[]).length).toBe(MAX_SAVED_PHRASES);
    expect(await database.db.collection("phrases").countDocuments({ deletedAt: null })).toBe(total);
  }, 15_000);

  it("schedules a retry when offline and marks the connection revoked when the server says so", async () => {
    const scheduled: (Date | null)[] = [];
    const storage = memoryStorage({
      [ACCOUNT_STATUS_STORAGE_KEY]: { connection: "connected" },
      [POPUP_PREFERENCES_STORAGE_KEY]: { targetLanguage: "ne" },
      [SAVED_PHRASES_STORAGE_KEY]: [local("queued")],
    });
    let mode: "offline" | "revoked" = "offline";
    const service = createSyncService({
      client: serverClient({
        sync: async () => {
          throw mode === "offline"
            ? new AccountClientError(
                "network",
                "The dashboard can’t be reached. Sync will retry.",
                true,
              )
            : new AccountClientError("revoked", "disconnected", false);
        },
      }),
      hasCredentials: async () => true,
      newId,
      now: () => NOW,
      scheduleAt: async (when) => {
        scheduled.push(when);
      },
      storage,
    });

    await expect(service.run()).resolves.toBe("retry-scheduled");
    expect(scheduled.at(-1)?.getTime()).toBeGreaterThan(NOW.getTime());
    expect(normalizeAccountStatus(storage.data[ACCOUNT_STATUS_STORAGE_KEY])).toMatchObject({
      pendingChanges: 1,
      syncing: false,
    });

    mode = "revoked";
    await expect(service.run()).resolves.toBe("revoked");
    expect(normalizeAccountStatus(storage.data[ACCOUNT_STATUS_STORAGE_KEY]).connection).toBe(
      "revoked",
    );
    expect(scheduled.at(-1)).toBeNull();
    expect(storage.data[SAVED_PHRASES_STORAGE_KEY]).toHaveLength(1);
    expect(JSON.stringify(storage.data[SYNC_STATE_STORAGE_KEY])).not.toMatch(/token/iu);
  });

  it("never stores credentials in chrome.storage-backed state", async () => {
    const storage = memoryStorage({ [ACCOUNT_STATUS_STORAGE_KEY]: { connection: "connected" } });
    const service = createSyncService({
      client: serverClient(),
      hasCredentials: async () => true,
      newId,
      now: () => NOW,
      scheduleAt: async () => undefined,
      storage,
    });
    await service.markConnected({ displayName: "D", email: "d@example.test" });
    await service.run();
    expect(JSON.stringify(storage.data)).not.toMatch(/accessToken|refreshToken|Bearer/u);
  });
});
