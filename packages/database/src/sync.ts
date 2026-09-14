import {
  MAX_SYNC_CHANGES,
  MAX_SYNCED_PHRASES_PER_USER,
  type PhraseContent,
  type PhraseRecord,
  type PreferencePatch,
  type SyncedPreferences,
  type SyncMutation,
  type SyncMutationResult,
  type SyncRejectionReason,
  type SyncRequest,
  type SyncResponse,
} from "@lingobridge/contracts/account";
import { type Database, type SqlClient, toInteger } from "./client.js";
import {
  getPhraseRecord,
  getPreferences,
  PHRASE_COLUMNS,
  PREFERENCE_COLUMNS,
  type PhraseRow,
  toPhraseRecord,
  toSyncedPreferences,
} from "./phrases.js";

export class AccountUnavailableError extends Error {
  constructor() {
    super("The account does not exist or has been deleted.");
    this.name = "AccountUnavailableError";
  }
}

export const TOMBSTONE_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
export const MUTATION_RECEIPT_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Serializes writes for one account. Change sequence numbers are allocated while the lock is held,
 * so a reader can never observe a later change before an earlier one for the same user commits.
 */
export async function lockAccount(client: SqlClient, userId: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    "select id from users where id = $1 and deleted_at is null for update",
    [userId],
  );
  if (rows.length === 0) throw new AccountUnavailableError();
}

async function nextChangeSeq(client: SqlClient): Promise<string> {
  const { rows } = await client.query<{ seq: string }>(
    "select nextval('sync_change_seq')::text as seq",
  );
  if (!rows[0]) throw new Error("Change sequence returned no value.");
  return rows[0].seq;
}

async function lockedPhrase(
  client: SqlClient,
  userId: string,
  phraseId: string,
): Promise<PhraseRecord | null> {
  const { rows } = await client.query<PhraseRow>(
    `select ${PHRASE_COLUMNS} from phrases where user_id = $1 and id = $2 for update`,
    [userId, phraseId],
  );
  return rows[0] ? toPhraseRecord(rows[0]) : null;
}

export interface PhraseWriteOutcome {
  phrase: PhraseRecord | null;
  reason: SyncRejectionReason | null;
  status: "applied" | "conflict" | "rejected";
}

function sameContent(record: PhraseRecord, content: PhraseContent): boolean {
  return (
    record.state === "live" &&
    record.sourceText === content.sourceText &&
    record.translatedText === content.translatedText &&
    record.sourceLanguage === content.sourceLanguage &&
    record.targetLanguage === content.targetLanguage
  );
}

/**
 * Revision rules:
 * - A new phrase must arrive with base revision 0.
 * - An update must name the revision it was based on; anything else is a conflict and the current
 *   record is returned so the client can reconcile.
 * - A tombstone always wins. A stale client cannot silently recreate a phrase the user deleted.
 */
export async function upsertPhrase(
  client: SqlClient,
  userId: string,
  input: { baseRevision: number; phrase: PhraseContent },
  now: Date,
): Promise<PhraseWriteOutcome> {
  const existing = await lockedPhrase(client, userId, input.phrase.id);

  if (!existing) {
    if (input.baseRevision > 0) return { phrase: null, reason: null, status: "conflict" };
    const count = await client.query<{ total: unknown }>(
      "select count(*) as total from phrases where user_id = $1 and deleted_at is null",
      [userId],
    );
    if (toInteger(count.rows[0]?.total ?? 0) >= MAX_SYNCED_PHRASES_PER_USER) {
      return { phrase: null, reason: "limit-reached", status: "rejected" };
    }
    const { rows } = await client.query<PhraseRow>(
      `insert into phrases (user_id, id, source_text, translated_text, source_language,
                            target_language, provider, note, saved_at, updated_at, revision,
                            change_seq)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11)
       returning ${PHRASE_COLUMNS}`,
      [
        userId,
        input.phrase.id,
        input.phrase.sourceText,
        input.phrase.translatedText,
        input.phrase.sourceLanguage,
        input.phrase.targetLanguage,
        input.phrase.provider,
        input.phrase.note,
        input.phrase.savedAt,
        now,
        await nextChangeSeq(client),
      ],
    );
    return { phrase: rows[0] ? toPhraseRecord(rows[0]) : null, reason: null, status: "applied" };
  }

  if (existing.state === "deleted") return { phrase: existing, reason: null, status: "conflict" };
  if (existing.revision !== input.baseRevision) {
    return { phrase: existing, reason: null, status: "conflict" };
  }
  if (sameContent(existing, input.phrase) && existing.note === input.phrase.note) {
    return { phrase: existing, reason: null, status: "applied" };
  }

  const { rows } = await client.query<PhraseRow>(
    `update phrases
        set source_text = $3, translated_text = $4, source_language = $5, target_language = $6,
            provider = $7, note = $8, updated_at = $9, revision = revision + 1, change_seq = $10
      where user_id = $1 and id = $2
      returning ${PHRASE_COLUMNS}`,
    [
      userId,
      input.phrase.id,
      input.phrase.sourceText,
      input.phrase.translatedText,
      input.phrase.sourceLanguage,
      input.phrase.targetLanguage,
      input.phrase.provider,
      input.phrase.note,
      now,
      await nextChangeSeq(client),
    ],
  );
  return { phrase: rows[0] ? toPhraseRecord(rows[0]) : null, reason: null, status: "applied" };
}

/**
 * Deletion is the user's explicit intent, so it applies over any revision. The tombstone keeps
 * the identifier and revision needed to propagate the deletion, and nothing the user wrote.
 */
export async function deletePhrase(
  client: SqlClient,
  userId: string,
  phraseId: string,
  now: Date,
): Promise<PhraseWriteOutcome> {
  const existing = await lockedPhrase(client, userId, phraseId);
  if (!existing) return { phrase: null, reason: null, status: "applied" };
  if (existing.state === "deleted") return { phrase: existing, reason: null, status: "applied" };

  const { rows } = await client.query<PhraseRow>(
    `update phrases
        set source_text = null, translated_text = null, source_language = null,
            target_language = null, provider = null, note = null, deleted_at = $3,
            updated_at = $3, revision = revision + 1, change_seq = $4
      where user_id = $1 and id = $2
      returning ${PHRASE_COLUMNS}`,
    [userId, phraseId, now, await nextChangeSeq(client)],
  );
  return { phrase: rows[0] ? toPhraseRecord(rows[0]) : null, reason: null, status: "applied" };
}

export type NoteUpdateOutcome =
  | { phrase: PhraseRecord; status: "applied" | "conflict" }
  | { status: "not-found" };

export async function updatePhraseNote(
  database: Database,
  userId: string,
  input: { baseRevision: number; note: string | null; phraseId: string },
  now: Date,
): Promise<NoteUpdateOutcome> {
  return database.transaction(async (client) => {
    await lockAccount(client, userId);
    const existing = await lockedPhrase(client, userId, input.phraseId);
    if (!existing || existing.state === "deleted") return { status: "not-found" };
    const outcome = await upsertPhrase(
      client,
      userId,
      {
        baseRevision: input.baseRevision,
        phrase: {
          id: existing.id,
          note: input.note,
          provider: existing.provider,
          savedAt: existing.savedAt,
          sourceLanguage: existing.sourceLanguage,
          sourceText: existing.sourceText,
          targetLanguage: existing.targetLanguage,
          translatedText: existing.translatedText,
        },
      },
      now,
    );
    if (!outcome.phrase) return { status: "not-found" };
    return {
      phrase: outcome.phrase,
      status: outcome.status === "applied" ? "applied" : "conflict",
    };
  });
}

export async function deletePhrases(
  database: Database,
  userId: string,
  phraseIds: readonly string[],
  now: Date,
): Promise<number> {
  return database.transaction(async (client) => {
    await lockAccount(client, userId);
    let deleted = 0;
    for (const phraseId of new Set(phraseIds)) {
      const before = await getPhraseRecord(client, userId, phraseId);
      if (before?.state !== "live") continue;
      await deletePhrase(client, userId, phraseId, now);
      deleted += 1;
    }
    return deleted;
  });
}

export async function deleteAllPhrases(
  database: Database,
  userId: string,
  now: Date,
): Promise<number> {
  return database.transaction(async (client) => {
    await lockAccount(client, userId);
    const { rows } = await client.query<{ id: string }>(
      "select id from phrases where user_id = $1 and deleted_at is null",
      [userId],
    );
    for (const row of rows) await deletePhrase(client, userId, row.id, now);
    return rows.length;
  });
}

export interface PreferencesWriteOutcome {
  preferences: SyncedPreferences;
  status: "applied" | "conflict";
}

export async function updatePreferences(
  client: SqlClient,
  userId: string,
  input: {
    baseRevision: number;
    patch: Partial<PreferencePatch> & { phraseSyncEnabled?: boolean };
  },
  now: Date,
): Promise<PreferencesWriteOutcome> {
  const { rows } = await client.query<Parameters<typeof toSyncedPreferences>[0]>(
    `select ${PREFERENCE_COLUMNS} from preferences where user_id = $1 for update`,
    [userId],
  );
  const current = rows[0] ? toSyncedPreferences(rows[0]) : null;
  if (!current) throw new AccountUnavailableError();
  if (current.revision !== input.baseRevision) {
    return { preferences: current, status: "conflict" };
  }

  const next = {
    phraseSyncEnabled: input.patch.phraseSyncEnabled ?? current.phraseSyncEnabled,
    preferredTargetLanguage:
      input.patch.preferredTargetLanguage === undefined
        ? current.preferredTargetLanguage
        : input.patch.preferredTargetLanguage,
    processingPreference:
      input.patch.processingPreference === undefined
        ? current.processingPreference
        : input.patch.processingPreference,
  };
  const updated = await client.query<Parameters<typeof toSyncedPreferences>[0]>(
    `update preferences
        set preferred_target_language = $2, processing_preference = $3,
            phrase_sync_enabled = $4, revision = revision + 1, updated_at = $5, change_seq = $6
      where user_id = $1
      returning ${PREFERENCE_COLUMNS}`,
    [
      userId,
      next.preferredTargetLanguage,
      next.processingPreference,
      next.phraseSyncEnabled,
      now,
      await nextChangeSeq(client),
    ],
  );
  if (!updated.rows[0]) throw new AccountUnavailableError();
  return { preferences: toSyncedPreferences(updated.rows[0]), status: "applied" };
}

export async function updateDashboardPreferences(
  database: Database,
  userId: string,
  input: {
    baseRevision: number;
    patch: Partial<PreferencePatch> & { phraseSyncEnabled?: boolean };
  },
  now: Date,
): Promise<PreferencesWriteOutcome> {
  return database.transaction(async (client) => {
    await lockAccount(client, userId);
    return updatePreferences(client, userId, input, now);
  });
}

async function applyMutation(
  client: SqlClient,
  userId: string,
  mutation: SyncMutation,
  phraseSyncEnabled: boolean,
  now: Date,
): Promise<SyncMutationResult> {
  const base = { mutationId: mutation.mutationId, phrase: null, preferences: null, reason: null };

  if (mutation.kind === "update-preferences") {
    const outcome = await updatePreferences(
      client,
      userId,
      { baseRevision: mutation.baseRevision, patch: mutation.preferences },
      now,
    );
    return { ...base, preferences: outcome.preferences, status: outcome.status };
  }

  if (mutation.kind === "delete-phrase") {
    const outcome = await deletePhrase(client, userId, mutation.phraseId, now);
    return { ...base, phrase: outcome.phrase, status: outcome.status };
  }

  if (!phraseSyncEnabled) return { ...base, reason: "sync-disabled", status: "rejected" };
  const outcome = await upsertPhrase(
    client,
    userId,
    { baseRevision: mutation.baseRevision, phrase: mutation.phrase },
    now,
  );
  return { ...base, phrase: outcome.phrase, reason: outcome.reason, status: outcome.status };
}

function mutationPhraseId(mutation: SyncMutation): string | null {
  if (mutation.kind === "upsert-phrase") return mutation.phrase.id;
  if (mutation.kind === "delete-phrase") return mutation.phraseId;
  return null;
}

async function tombstonePurgeHorizon(client: SqlClient): Promise<bigint> {
  const { rows } = await client.query<{ value: string }>(
    "select value::text as value from sync_metadata where key = 'tombstone_purge_seq'",
  );
  return rows[0] ? BigInt(rows[0].value) : 0n;
}

/**
 * One round trip: apply the client's queued mutations in order, then return everything that
 * changed after its cursor. Replaying a mutation id returns the current state without applying it
 * again, which is what makes offline retries safe.
 */
export async function runSync(
  database: Database,
  userId: string,
  request: SyncRequest,
  now: Date,
): Promise<SyncResponse> {
  return database.transaction(async (client) => {
    await lockAccount(client, userId);
    const preferencesBefore = await getPreferences(client, userId);

    const results: SyncMutationResult[] = [];
    for (const mutation of request.mutations) {
      const receipt = await client.query<{
        reason: SyncRejectionReason | null;
        status: SyncMutationResult["status"];
      }>("select status, reason from sync_mutations where user_id = $1 and mutation_id = $2", [
        userId,
        mutation.mutationId,
      ]);
      const phraseId = mutationPhraseId(mutation);

      if (receipt.rows[0]) {
        results.push({
          mutationId: mutation.mutationId,
          phrase: phraseId ? await getPhraseRecord(client, userId, phraseId) : null,
          preferences:
            mutation.kind === "update-preferences" ? await getPreferences(client, userId) : null,
          reason: receipt.rows[0].reason,
          status: receipt.rows[0].status,
        });
        continue;
      }

      const result = await applyMutation(
        client,
        userId,
        mutation,
        preferencesBefore.phraseSyncEnabled,
        now,
      );
      await client.query(
        `insert into sync_mutations (user_id, mutation_id, status, reason, phrase_id, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [userId, mutation.mutationId, result.status, result.reason, phraseId, now],
      );
      results.push(result);
    }

    const preferences = await getPreferences(client, userId);
    const pull = await readChanges(client, userId, request.cursor, preferences);
    return { ...pull, results };
  });
}

interface ParsedCursor {
  /** True for the first page of a resynchronization. */
  beginsResync: boolean;
  /** True for every page of a resynchronization. */
  resyncing: boolean;
  seq: bigint;
}

async function parseCursor(client: SqlClient, cursor: string | null): Promise<ParsedCursor> {
  if (cursor === null) return { beginsResync: true, resyncing: true, seq: 0n };
  if (cursor.startsWith("r"))
    return { beginsResync: false, resyncing: true, seq: BigInt(cursor.slice(1)) };
  const seq = BigInt(cursor);
  if (seq < (await tombstonePurgeHorizon(client))) {
    return { beginsResync: true, resyncing: true, seq: 0n };
  }
  return { beginsResync: false, resyncing: false, seq };
}

async function readChanges(
  client: SqlClient,
  userId: string,
  requestedCursor: string | null,
  preferences: SyncedPreferences,
): Promise<Omit<SyncResponse, "results">> {
  const cursor = await parseCursor(client, requestedCursor);
  const prefsSeqResult = await client.query<{ seq: string }>(
    "select change_seq::text as seq from preferences where user_id = $1",
    [userId],
  );
  const preferencesSeq = BigInt(prefsSeqResult.rows[0]?.seq ?? "0");

  if (!preferences.phraseSyncEnabled) {
    // Phrase changes are withheld, and the cursor does not move past them, so re-enabling sync
    // later delivers everything that changed in the meantime.
    return {
      changes: { phrases: [], preferences: preferencesSeq > cursor.seq ? preferences : null },
      cursor: requestedCursor ?? "0",
      fullResync: false,
      hasMore: false,
      phraseSyncEnabled: false,
    };
  }

  // The text alias must not share the column's name: ORDER BY resolves output aliases first, and
  // sorting sequence numbers as text ("99" after "100") would make the cursor skip records.
  const { rows } = await client.query<PhraseRow & { change_seq_text: string }>(
    `select ${PHRASE_COLUMNS}, change_seq::text as change_seq_text from phrases
      where user_id = $1 and change_seq > $2::bigint
      order by phrases.change_seq
      limit $3`,
    [userId, cursor.seq.toString(), MAX_SYNC_CHANGES + 1],
  );
  const hasMore = rows.length > MAX_SYNC_CHANGES;
  const page = rows.slice(0, MAX_SYNC_CHANGES);
  const lastPhraseSeq =
    page.length > 0 ? BigInt(page[page.length - 1]?.change_seq_text ?? "0") : 0n;

  const phrases = page
    .map(toPhraseRecord)
    // A resynchronization starts from nothing, so tombstones carry no information for it.
    .filter((record) => !cursor.resyncing || record.state === "live");

  if (hasMore) {
    return {
      changes: { phrases, preferences: null },
      cursor: `${cursor.resyncing ? "r" : ""}${lastPhraseSeq}`,
      fullResync: cursor.beginsResync,
      hasMore: true,
      phraseSyncEnabled: true,
    };
  }

  // The final cursor also clears the purge horizon; otherwise a client whose newest remaining
  // record predates a purged tombstone would be sent back into resynchronization every time.
  let upper = cursor.seq;
  for (const candidate of [lastPhraseSeq, preferencesSeq, await tombstonePurgeHorizon(client)]) {
    if (candidate > upper) upper = candidate;
  }
  return {
    changes: {
      phrases,
      preferences: cursor.resyncing || preferencesSeq > cursor.seq ? preferences : null,
    },
    cursor: upper.toString(),
    fullResync: cursor.beginsResync,
    hasMore: false,
    phraseSyncEnabled: true,
  };
}

/**
 * Tombstones outlive the offline window of any client that still holds a newer cursor. A client
 * whose cursor predates the purge is told to resynchronize from scratch instead.
 */
export async function purgeSyncMetadata(database: Database, now: Date): Promise<void> {
  await database.transaction(async (client) => {
    const tombstoneCutoff = new Date(now.getTime() - TOMBSTONE_RETENTION_MILLISECONDS);
    const purged = await client.query<{ seq: string | null }>(
      `with removed as (
         delete from phrases where deleted_at is not null and deleted_at < $1
         returning change_seq
       )
       select max(change_seq)::text as seq from removed`,
      [tombstoneCutoff],
    );
    const seq = purged.rows[0]?.seq;
    if (seq) {
      await client.query(
        `insert into sync_metadata (key, value) values ('tombstone_purge_seq', $1)
         on conflict (key) do update set value = greatest(sync_metadata.value, excluded.value)`,
        [seq],
      );
    }
    await client.query("delete from sync_mutations where created_at < $1", [
      new Date(now.getTime() - MUTATION_RECEIPT_RETENTION_MILLISECONDS),
    ]);
  });
}
