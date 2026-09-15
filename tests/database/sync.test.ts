import { MAX_SYNC_CHANGES, type SyncMutation } from "@lingobridge/contracts/account";
import {
  type Database,
  deletePhrases,
  openInMemoryDatabase,
  purgeSyncMetadata,
  runSync,
  updateDashboardPreferences,
  updatePhraseNote,
} from "@lingobridge/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUser, phrase } from "../support/account-fixtures";

const NOW = new Date("2026-09-14T10:00:00.000Z");
let database: Database;
let userId: string;

beforeEach(async () => {
  database = await openInMemoryDatabase();
  userId = (await createUser(database, "sync@example.test", NOW)).id;
});

afterEach(async () => {
  await database.close();
});

const upsert = (content = phrase(), baseRevision = 0): SyncMutation => ({
  baseRevision,
  kind: "upsert-phrase",
  mutationId: crypto.randomUUID(),
  phrase: content,
});

describe("sync writes", () => {
  it("is idempotent: replaying a mutation id does not apply it twice", async () => {
    const mutation = upsert();
    const first = await runSync(database, userId, { cursor: null, mutations: [mutation] }, NOW);
    const replay = await runSync(
      database,
      userId,
      { cursor: first.cursor, mutations: [mutation] },
      NOW,
    );

    expect(first.results[0]).toMatchObject({ phrase: { revision: 1 }, status: "applied" });
    expect(replay.results[0]).toMatchObject({ phrase: { revision: 1 }, status: "applied" });
    const rows = await database.db
      .collection("phrases")
      .find({ userId }, { projection: { _id: 0, revision: 1 } })
      .toArray();
    expect(rows).toEqual([{ revision: 1 }]);
  });

  it("returns a conflict with the current record when the base revision is stale", async () => {
    const content = phrase();
    await runSync(database, userId, { cursor: null, mutations: [upsert(content)] }, NOW);
    await updatePhraseNote(
      database,
      userId,
      { baseRevision: 1, note: "edited on the web", phraseId: content.id },
      NOW,
    );

    const stale = await runSync(
      database,
      userId,
      { cursor: null, mutations: [upsert({ ...content, note: "edited offline" }, 1)] },
      NOW,
    );
    expect(stale.results[0]).toMatchObject({
      phrase: { note: "edited on the web", revision: 2 },
      status: "conflict",
    });
  });

  it("serializes concurrent syncs for one account without losing or reordering changes", async () => {
    const contents = Array.from({ length: 8 }, () => phrase());
    await Promise.all(
      contents.map((content) =>
        runSync(database, userId, { cursor: null, mutations: [upsert(content)] }, NOW),
      ),
    );

    const stored = await database.db
      .collection<{ changeSeq: number; revision: number }>("phrases")
      .find({ userId })
      .toArray();
    expect(stored).toHaveLength(contents.length);
    expect(stored.every((document) => document.revision === 1)).toBe(true);
    const sequences = stored.map((document) => document.changeSeq).sort((a, b) => a - b);
    expect(sequences).toEqual(contents.map((_, index) => index + 1));

    const pulled = await runSync(database, userId, { cursor: null, mutations: [] }, NOW);
    expect(pulled.changes.phrases).toHaveLength(contents.length);
  });

  it("never lets a stale client recreate a deleted phrase", async () => {
    const content = phrase();
    await runSync(database, userId, { cursor: null, mutations: [upsert(content)] }, NOW);
    await deletePhrases(database, userId, [content.id], NOW);

    const stale = await runSync(
      database,
      userId,
      { cursor: null, mutations: [upsert(content, 1)] },
      NOW,
    );
    expect(stale.results[0]).toMatchObject({
      phrase: { id: content.id, state: "deleted" },
      status: "conflict",
    });

    const recreated = await runSync(
      database,
      userId,
      { cursor: null, mutations: [upsert(content, 0)] },
      NOW,
    );
    expect(recreated.results[0]?.status).toBe("conflict");
  });

  it("applies deletion over any revision and treats repeated deletion as success", async () => {
    const content = phrase();
    await runSync(database, userId, { cursor: null, mutations: [upsert(content)] }, NOW);
    await updatePhraseNote(
      database,
      userId,
      { baseRevision: 1, note: "newer", phraseId: content.id },
      NOW,
    );

    const remove = (base: number): SyncMutation => ({
      baseRevision: base,
      kind: "delete-phrase",
      mutationId: crypto.randomUUID(),
      phraseId: content.id,
    });
    const first = await runSync(database, userId, { cursor: null, mutations: [remove(1)] }, NOW);
    const second = await runSync(database, userId, { cursor: null, mutations: [remove(1)] }, NOW);
    expect(first.results[0]).toMatchObject({
      phrase: { revision: 3, state: "deleted" },
      status: "applied",
    });
    expect(second.results[0]).toMatchObject({
      phrase: { revision: 3, state: "deleted" },
      status: "applied",
    });
  });

  it("rejects new phrases while phrase sync is off but still accepts deletions", async () => {
    const existing = phrase();
    await runSync(database, userId, { cursor: null, mutations: [upsert(existing)] }, NOW);
    await updateDashboardPreferences(
      database,
      userId,
      { baseRevision: 0, patch: { phraseSyncEnabled: false } },
      NOW,
    );

    const response = await runSync(
      database,
      userId,
      {
        cursor: null,
        mutations: [
          upsert(),
          {
            baseRevision: 1,
            kind: "delete-phrase",
            mutationId: crypto.randomUUID(),
            phraseId: existing.id,
          },
        ],
      },
      NOW,
    );
    expect(response.phraseSyncEnabled).toBe(false);
    expect(response.results.map((result) => [result.status, result.reason])).toEqual([
      ["rejected", "sync-disabled"],
      ["applied", null],
    ]);
    expect(response.changes.phrases).toEqual([]);
  });

  it("resolves preference updates by revision", async () => {
    const mutation = (base: number, language: string): SyncMutation => ({
      baseRevision: base,
      kind: "update-preferences",
      mutationId: crypto.randomUUID(),
      preferences: { preferredTargetLanguage: language, processingPreference: "online" },
    });
    const applied = await runSync(
      database,
      userId,
      { cursor: null, mutations: [mutation(0, "ne")] },
      NOW,
    );
    expect(applied.results[0]).toMatchObject({
      preferences: { preferredTargetLanguage: "ne", revision: 1 },
      status: "applied",
    });

    const stale = await runSync(
      database,
      userId,
      { cursor: null, mutations: [mutation(0, "hi")] },
      NOW,
    );
    expect(stale.results[0]).toMatchObject({
      preferences: { preferredTargetLanguage: "ne" },
      status: "conflict",
    });
  });
});

describe("sync pulls", () => {
  it("delivers updates and deletions made elsewhere after the cursor", async () => {
    const content = phrase();
    const first = await runSync(
      database,
      userId,
      { cursor: null, mutations: [upsert(content)] },
      NOW,
    );
    const idle = await runSync(database, userId, { cursor: first.cursor, mutations: [] }, NOW);
    expect(idle.changes.phrases).toEqual([]);
    expect(idle.fullResync).toBe(false);

    await updatePhraseNote(
      database,
      userId,
      { baseRevision: 1, note: "from the dashboard", phraseId: content.id },
      NOW,
    );
    const updated = await runSync(database, userId, { cursor: idle.cursor, mutations: [] }, NOW);
    expect(updated.changes.phrases).toMatchObject([{ note: "from the dashboard", state: "live" }]);

    await deletePhrases(database, userId, [content.id], NOW);
    const deleted = await runSync(database, userId, { cursor: updated.cursor, mutations: [] }, NOW);
    expect(deleted.changes.phrases).toMatchObject([{ id: content.id, state: "deleted" }]);
    expect(JSON.stringify(deleted)).not.toContain(content.sourceText);
  });

  it("pages large change sets without skipping records", async () => {
    const total = MAX_SYNC_CHANGES + 37;
    const contents = Array.from({ length: total }, () => phrase());
    for (let index = 0; index < contents.length; index += 100) {
      await runSync(
        database,
        userId,
        { cursor: null, mutations: contents.slice(index, index + 100).map((c) => upsert(c)) },
        NOW,
      );
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let firstPageResync = false;
    for (;;) {
      const response = await runSync(database, userId, { cursor, mutations: [] }, NOW);
      if (pages === 0) firstPageResync = response.fullResync;
      for (const record of response.changes.phrases) seen.add(record.id);
      cursor = response.cursor;
      pages += 1;
      if (!response.hasMore) break;
      expect(response.cursor.startsWith("r")).toBe(true);
    }
    expect(firstPageResync).toBe(true);
    expect(pages).toBe(2);
    expect(seen.size).toBe(total);
    expect(cursor).toMatch(/^\d+$/u);
  });

  it("sends a client whose cursor predates purged tombstones back to a full resync", async () => {
    const keep = phrase();
    const gone = phrase();
    const first = await runSync(
      database,
      userId,
      { cursor: null, mutations: [upsert(keep), upsert(gone)] },
      NOW,
    );
    await deletePhrases(database, userId, [gone.id], NOW);
    await purgeSyncMetadata(database, new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1_000));

    const response = await runSync(database, userId, { cursor: first.cursor, mutations: [] }, NOW);
    expect(response.fullResync).toBe(true);
    expect(response.changes.phrases.map((record) => record.id)).toEqual([keep.id]);

    const after = await runSync(database, userId, { cursor: response.cursor, mutations: [] }, NOW);
    expect(after.fullResync).toBe(false);
  });
});
