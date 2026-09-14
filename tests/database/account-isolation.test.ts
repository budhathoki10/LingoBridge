import {
  deleteAccount,
  deleteAllPhrases,
  deletePhrases,
  exportAccount,
  getAccountOverview,
  getPhraseRecord,
  getPreferences,
  listAllLivePhrases,
  listPhrases,
  migrations,
  openInMemoryDatabase,
  purgeDeletedAccounts,
  purgeSyncMetadata,
  revokeAllExtensionSessions,
  revokeExtensionSession,
  runMigrations,
  runSync,
  updateDashboardPreferences,
  updatePhraseNote,
  type Database,
  createExtensionSession,
  listExtensionSessions,
  getDeletionReceipt,
  findUserById,
  upsertUserFromIdentity,
} from "@lingobridge/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUser, phrase } from "../support/account-fixtures";

const NOW = new Date("2026-09-14T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;

let database: Database;

beforeEach(async () => {
  database = await openInMemoryDatabase();
});

afterEach(async () => {
  await database.close();
});

async function saveFor(userId: string, content = phrase()) {
  const response = await runSync(
    database,
    userId,
    {
      cursor: null,
      mutations: [
        {
          baseRevision: 0,
          kind: "upsert-phrase",
          mutationId: crypto.randomUUID(),
          phrase: content,
        },
      ],
    },
    NOW,
  );
  expect(response.results[0]?.status).toBe("applied");
  return content;
}

async function sessionFor(userId: string, label: string) {
  return createExtensionSession(
    database,
    {
      accessExpiresAt: new Date(NOW.getTime() + 60_000),
      accessTokenHash: `access-${label}-${crypto.randomUUID()}`,
      deviceLabel: label,
      expiresAt: new Date(NOW.getTime() + 90 * DAY),
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      refreshTokenHash: `refresh-${label}-${crypto.randomUUID()}`,
      userId,
    },
    NOW,
  );
}

describe("migrations", () => {
  it("apply once and are a no-op when run again", async () => {
    const rows = await database.query<{ id: string }>(
      "select id from schema_migrations order by id",
    );
    expect(rows.rows.map((row) => row.id)).toEqual(migrations.map((migration) => migration.id));
    await expect(runMigrations(database)).resolves.toEqual([]);
  });

  it("refuse a live phrase without text and a tombstone that still holds text", async () => {
    const user = await createUser(database, "shape@example.test", NOW);
    await expect(
      database.query(
        `insert into phrases (user_id, id, saved_at, updated_at, revision, change_seq)
         values ($1, 'broken', now(), now(), 1, 1)`,
        [user.id],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into phrases (user_id, id, source_text, translated_text, source_language, target_language,
                              provider, saved_at, updated_at, revision, deleted_at, change_seq)
         values ($1, 'leaky', 'a', 'b', 'en', 'ne', 'nvidia', now(), now(), 2, now(), 2)`,
        [user.id],
      ),
    ).rejects.toThrow();
  });
});

describe("cross-user authorization", () => {
  it("never returns, edits, or deletes another user's phrases", async () => {
    const alice = await createUser(database, "alice@example.test", NOW);
    const bob = await createUser(database, "bob@example.test", NOW);
    const secret = await saveFor(alice.id, phrase({ sourceText: "Alice private phrase" }));

    expect((await listPhrases(database, bob.id, { limit: 50, offset: 0 })).phrases).toEqual([]);
    expect(
      (await listPhrases(database, bob.id, { limit: 50, offset: 0, query: "Alice" })).total,
    ).toBe(0);
    expect(await getPhraseRecord(database, bob.id, secret.id)).toBeNull();
    expect(await listAllLivePhrases(database, bob.id)).toEqual([]);

    await expect(
      updatePhraseNote(
        database,
        bob.id,
        { baseRevision: 1, note: "hijack", phraseId: secret.id },
        NOW,
      ),
    ).resolves.toEqual({ status: "not-found" });
    await expect(deletePhrases(database, bob.id, [secret.id], NOW)).resolves.toBe(0);
    await expect(deleteAllPhrases(database, bob.id, NOW)).resolves.toBe(0);

    // Bob deleting the same id through sync affects only Bob's (nonexistent) record.
    const bobSync = await runSync(
      database,
      bob.id,
      {
        cursor: null,
        mutations: [
          {
            baseRevision: 1,
            kind: "delete-phrase",
            mutationId: crypto.randomUUID(),
            phraseId: secret.id,
          },
        ],
      },
      NOW,
    );
    expect(bobSync.changes.phrases).toEqual([]);

    const aliceRecord = await getPhraseRecord(database, alice.id, secret.id);
    expect(aliceRecord).toMatchObject({
      note: null,
      sourceText: "Alice private phrase",
      state: "live",
    });
  });

  it("lets the same phrase id exist independently for two users", async () => {
    const alice = await createUser(database, "alice2@example.test", NOW);
    const bob = await createUser(database, "bob2@example.test", NOW);
    await saveFor(alice.id, phrase({ id: "shared-id", sourceText: "Alice" }));
    await saveFor(bob.id, phrase({ id: "shared-id", sourceText: "Bob" }));
    expect(
      (await getPhraseRecord(database, alice.id, "shared-id")) as { sourceText: string },
    ).toMatchObject({ sourceText: "Alice" });
    expect(
      (await getPhraseRecord(database, bob.id, "shared-id")) as { sourceText: string },
    ).toMatchObject({ sourceText: "Bob" });
  });

  it("isolates preferences, sessions, overview, and export", async () => {
    const alice = await createUser(database, "alice3@example.test", NOW);
    const bob = await createUser(database, "bob3@example.test", NOW);
    await updateDashboardPreferences(
      database,
      alice.id,
      { baseRevision: 0, patch: { preferredTargetLanguage: "ne" } },
      NOW,
    );
    const aliceSession = await sessionFor(alice.id, "Alice laptop");
    await saveFor(alice.id);

    expect((await getPreferences(database, bob.id)).preferredTargetLanguage).toBeNull();
    expect(await listExtensionSessions(database, bob.id)).toEqual([]);
    await expect(revokeExtensionSession(database, bob.id, aliceSession.id, NOW)).resolves.toBe(
      false,
    );
    await expect(revokeAllExtensionSessions(database, bob.id, "user", NOW)).resolves.toBe(0);
    expect((await listExtensionSessions(database, alice.id))[0]?.revokedAt).toBeNull();

    const bobOverview = await getAccountOverview(database, bob.id, NOW);
    expect(bobOverview).toMatchObject({
      activeExtensionSessions: 0,
      phraseCount: 0,
      recentPhrases: [],
    });

    const bobExport = await exportAccount(database, bob.id, NOW);
    expect(JSON.stringify(bobExport)).not.toContain("alice");
    expect(JSON.stringify(bobExport)).not.toContain("Good morning");
  });

  it("exports session metadata without token hashes or extension ids", async () => {
    const alice = await createUser(database, "export@example.test", NOW);
    const session = await sessionFor(alice.id, "Work Chrome");
    const exported = JSON.stringify(await exportAccount(database, alice.id, NOW));
    expect(exported).toContain("Work Chrome");
    expect(exported).not.toContain("access-");
    expect(exported).not.toContain("refresh-");
    expect(exported).not.toContain(session.extensionId);
  });
});

describe("tombstones", () => {
  it("erase phrase text and notes at deletion time", async () => {
    const user = await createUser(database, "tomb@example.test", NOW);
    const saved = await saveFor(user.id, phrase({ note: "private note", sourceText: "Delete me" }));
    await deletePhrases(database, user.id, [saved.id], NOW);

    const raw = await database.query<Record<string, unknown>>(
      "select source_text, translated_text, note, provider, deleted_at from phrases where user_id = $1",
      [user.id],
    );
    expect(raw.rows[0]).toMatchObject({
      note: null,
      provider: null,
      source_text: null,
      translated_text: null,
    });
    expect(raw.rows[0]?.deleted_at).not.toBeNull();
  });

  it("are purged after the retention window and mutation receipts after a week", async () => {
    const user = await createUser(database, "purge@example.test", NOW);
    const saved = await saveFor(user.id);
    await deletePhrases(database, user.id, [saved.id], NOW);

    await purgeSyncMetadata(database, new Date(NOW.getTime() + 29 * DAY));
    expect((await database.query("select id from phrases")).rows).toHaveLength(1);
    await purgeSyncMetadata(database, new Date(NOW.getTime() + 31 * DAY));
    expect((await database.query("select id from phrases")).rows).toHaveLength(0);
    expect((await database.query("select mutation_id from sync_mutations")).rows).toHaveLength(0);
  });
});

describe("account deletion", () => {
  it("removes content, revokes every session, de-identifies the account, and issues a receipt", async () => {
    const alice = await createUser(database, "delete@example.test", NOW);
    const bob = await createUser(database, "keep@example.test", NOW);
    await saveFor(alice.id);
    await saveFor(bob.id);
    await sessionFor(alice.id, "One");
    await sessionFor(alice.id, "Two");

    const result = await deleteAccount(database, alice.id, NOW);
    expect(result.revokedExtensionSessions).toBe(2);
    expect(result.receipt.accountPurgeAfter).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());

    expect(
      (await database.query("select 1 from phrases where user_id = $1", [alice.id])).rows,
    ).toHaveLength(0);
    expect(
      (await database.query("select 1 from preferences where user_id = $1", [alice.id])).rows,
    ).toHaveLength(0);
    const sessions = await listExtensionSessions(database, alice.id);
    expect(sessions.every((session) => session.revokedReason === "account-deleted")).toBe(true);

    const shell = await database.query<{
      display_name: string | null;
      email: string | null;
      identity_subject: string;
    }>("select email, display_name, identity_subject from users where id = $1", [alice.id]);
    expect(shell.rows[0]).toMatchObject({ display_name: null, email: null });
    expect(shell.rows[0]?.identity_subject).toBe(`deleted:${alice.id}`);
    expect(await findUserById(database, alice.id)).toBeNull();

    // Bob is untouched.
    expect((await listAllLivePhrases(database, bob.id)).length).toBe(1);

    // Signing in again with the same identity creates a fresh, empty account.
    const again = await database.transaction((client) =>
      upsertUserFromIdentity(
        client,
        {
          displayName: null,
          email: "delete@example.test",
          emailVerified: true,
          issuer: "https://issuer.test",
          subject: "subject-delete@example.test",
        },
        "user",
        NOW,
      ),
    );
    expect(again.id).not.toBe(alice.id);

    expect(await purgeDeletedAccounts(database, new Date(NOW.getTime() + 29 * DAY))).toBe(0);
    expect(await purgeDeletedAccounts(database, new Date(NOW.getTime() + 30 * DAY))).toBe(1);
    expect(
      (await database.query("select 1 from users where id = $1", [alice.id])).rows,
    ).toHaveLength(0);
    expect((await getDeletionReceipt(database, result.receipt.id))?.accountPurgedAt).not.toBeNull();
  });
});
