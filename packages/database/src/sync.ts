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
import { collection, type Database, type DbClient, inSession } from "./client.js";
import { getPhraseRecord, getPreferences, toPhraseRecord, toSyncedPreferences } from "./phrases.js";

export class AccountUnavailableError extends Error {
  constructor() {
    super("The account does not exist or has been deleted.");
    this.name = "AccountUnavailableError";
  }
}

export const TOMBSTONE_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
export const MUTATION_RECEIPT_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Serializes writes for one account. Writing the user document makes any concurrent transaction
 * on the same account hit a write conflict and retry, so change sequence numbers are allocated
 * in commit order and a reader never observes a later change before an earlier one.
 */
export async function lockAccount(client: DbClient, userId: string): Promise<void> {
  const result = await collection(client, "users").updateOne(
    { _id: userId, deletedAt: null },
    { $inc: { lockVersion: 1 } },
    inSession(client),
  );
  if (result.matchedCount === 0) throw new AccountUnavailableError();
}

/** Change sequences are per account; cursors are only ever compared within one account. */
async function nextChangeSeq(client: DbClient, userId: string): Promise<number> {
  const user = await collection(client, "users").findOneAndUpdate(
    { _id: userId },
    { $inc: { changeSeq: 1 } },
    { ...inSession(client), projection: { changeSeq: 1 }, returnDocument: "after" },
  );
  if (!user) throw new AccountUnavailableError();
  return user.changeSeq;
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
  client: DbClient,
  userId: string,
  input: { baseRevision: number; phrase: PhraseContent },
  now: Date,
): Promise<PhraseWriteOutcome> {
  const phrases = collection(client, "phrases");
  const existing = await getPhraseRecord(client, userId, input.phrase.id);

  if (!existing) {
    if (input.baseRevision > 0) return { phrase: null, reason: null, status: "conflict" };
    const count = await phrases.countDocuments({ deletedAt: null, userId }, inSession(client));
    if (count >= MAX_SYNCED_PHRASES_PER_USER) {
      return { phrase: null, reason: "limit-reached", status: "rejected" };
    }
    const document = {
      changeSeq: await nextChangeSeq(client, userId),
      deletedAt: null,
      id: input.phrase.id,
      note: input.phrase.note,
      provider: input.phrase.provider,
      revision: 1,
      savedAt: new Date(input.phrase.savedAt),
      sourceLanguage: input.phrase.sourceLanguage,
      sourceText: input.phrase.sourceText,
      targetLanguage: input.phrase.targetLanguage,
      translatedText: input.phrase.translatedText,
      updatedAt: now,
      userId,
    };
    await phrases.insertOne(document, inSession(client));
    return { phrase: toPhraseRecord(document), reason: null, status: "applied" };
  }

  if (existing.state === "deleted") return { phrase: existing, reason: null, status: "conflict" };
  if (existing.revision !== input.baseRevision) {
    return { phrase: existing, reason: null, status: "conflict" };
  }
  if (sameContent(existing, input.phrase) && existing.note === input.phrase.note) {
    return { phrase: existing, reason: null, status: "applied" };
  }

  const updated = await phrases.findOneAndUpdate(
    { id: input.phrase.id, userId },
    {
      $inc: { revision: 1 },
      $set: {
        changeSeq: await nextChangeSeq(client, userId),
        note: input.phrase.note,
        provider: input.phrase.provider,
        sourceLanguage: input.phrase.sourceLanguage,
        sourceText: input.phrase.sourceText,
        targetLanguage: input.phrase.targetLanguage,
        translatedText: input.phrase.translatedText,
        updatedAt: now,
      },
    },
    { ...inSession(client), returnDocument: "after" },
  );
  return { phrase: updated ? toPhraseRecord(updated) : null, reason: null, status: "applied" };
}

/**
 * Deletion is the user's explicit intent, so it applies over any revision. The tombstone keeps
 * the identifier and revision needed to propagate the deletion, and nothing the user wrote.
 */
export async function deletePhrase(
  client: DbClient,
  userId: string,
  phraseId: string,
  now: Date,
): Promise<PhraseWriteOutcome> {
  const existing = await getPhraseRecord(client, userId, phraseId);
  if (!existing) return { phrase: null, reason: null, status: "applied" };
  if (existing.state === "deleted") return { phrase: existing, reason: null, status: "applied" };

  const updated = await collection(client, "phrases").findOneAndUpdate(
    { id: phraseId, userId },
    {
      $inc: { revision: 1 },
      $set: {
        changeSeq: await nextChangeSeq(client, userId),
        deletedAt: now,
        note: null,
        provider: null,
        sourceLanguage: null,
        sourceText: null,
        targetLanguage: null,
        translatedText: null,
        updatedAt: now,
      },
    },
    { ...inSession(client), returnDocument: "after" },
  );
  return { phrase: updated ? toPhraseRecord(updated) : null, reason: null, status: "applied" };
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
    const existing = await getPhraseRecord(client, userId, input.phraseId);
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
    const live = await collection(client, "phrases")
      .find({ deletedAt: null, userId }, { ...inSession(client), projection: { id: 1 } })
      .toArray();
    for (const phrase of live) await deletePhrase(client, userId, phrase.id, now);
    return live.length;
  });
}

export interface PreferencesWriteOutcome {
  preferences: SyncedPreferences;
  status: "applied" | "conflict";
}

export async function updatePreferences(
  client: DbClient,
  userId: string,
  input: {
    baseRevision: number;
    patch: Partial<PreferencePatch> & { phraseSyncEnabled?: boolean };
  },
  now: Date,
): Promise<PreferencesWriteOutcome> {
  const preferences = collection(client, "preferences");
  const document = await preferences.findOne({ _id: userId }, inSession(client));
  if (!document) throw new AccountUnavailableError();
  const current = toSyncedPreferences(document);
  if (current.revision !== input.baseRevision) {
    return { preferences: current, status: "conflict" };
  }

  const updated = await preferences.findOneAndUpdate(
    { _id: userId },
    {
      $inc: { revision: 1 },
      $set: {
        changeSeq: await nextChangeSeq(client, userId),
        phraseSyncEnabled: input.patch.phraseSyncEnabled ?? current.phraseSyncEnabled,
        preferredTargetLanguage:
          input.patch.preferredTargetLanguage === undefined
            ? current.preferredTargetLanguage
            : input.patch.preferredTargetLanguage,
        processingPreference:
          input.patch.processingPreference === undefined
            ? current.processingPreference
            : input.patch.processingPreference,
        updatedAt: now,
      },
    },
    { ...inSession(client), returnDocument: "after" },
  );
  if (!updated) throw new AccountUnavailableError();
  return { preferences: toSyncedPreferences(updated), status: "applied" };
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
  client: DbClient,
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
    const receipts = collection(client, "syncMutations");

    const results: SyncMutationResult[] = [];
    for (const mutation of request.mutations) {
      const receipt = await receipts.findOne(
        { mutationId: mutation.mutationId, userId },
        inSession(client),
      );
      const phraseId = mutationPhraseId(mutation);

      if (receipt) {
        results.push({
          mutationId: mutation.mutationId,
          phrase: phraseId ? await getPhraseRecord(client, userId, phraseId) : null,
          preferences:
            mutation.kind === "update-preferences" ? await getPreferences(client, userId) : null,
          reason: receipt.reason as SyncRejectionReason | null,
          status: receipt.status,
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
      await receipts.insertOne(
        {
          createdAt: now,
          mutationId: mutation.mutationId,
          phraseId,
          reason: result.reason,
          status: result.status,
          userId,
        },
        inSession(client),
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
  seq: number;
}

function parseCursor(cursor: string | null, purgeHorizon: number): ParsedCursor {
  if (cursor === null) return { beginsResync: true, resyncing: true, seq: 0 };
  if (cursor.startsWith("r")) {
    return { beginsResync: false, resyncing: true, seq: Number(BigInt(cursor.slice(1))) };
  }
  const seq = Number(BigInt(cursor));
  if (seq < purgeHorizon) return { beginsResync: true, resyncing: true, seq: 0 };
  return { beginsResync: false, resyncing: false, seq };
}

async function readChanges(
  client: DbClient,
  userId: string,
  requestedCursor: string | null,
  preferences: SyncedPreferences,
): Promise<Omit<SyncResponse, "results">> {
  const user = await collection(client, "users").findOne(
    { _id: userId },
    { ...inSession(client), projection: { tombstonePurgeSeq: 1 } },
  );
  const purgeHorizon = user?.tombstonePurgeSeq ?? 0;
  const cursor = parseCursor(requestedCursor, purgeHorizon);
  const preferencesDocument = await collection(client, "preferences").findOne(
    { _id: userId },
    { ...inSession(client), projection: { changeSeq: 1 } },
  );
  const preferencesSeq = preferencesDocument?.changeSeq ?? 0;

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

  const documents = await collection(client, "phrases")
    .find({ changeSeq: { $gt: cursor.seq }, userId }, inSession(client))
    .sort({ changeSeq: 1 })
    .limit(MAX_SYNC_CHANGES + 1)
    .toArray();
  const hasMore = documents.length > MAX_SYNC_CHANGES;
  const page = documents.slice(0, MAX_SYNC_CHANGES);
  const lastPhraseSeq = page.at(-1)?.changeSeq ?? 0;

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
  const upper = Math.max(cursor.seq, lastPhraseSeq, preferencesSeq, purgeHorizon);
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
    const tombstoneFilter = {
      deletedAt: { $lt: new Date(now.getTime() - TOMBSTONE_RETENTION_MILLISECONDS) },
    };
    const phrases = collection(client, "phrases");
    const horizons = await phrases
      .aggregate<{ _id: string; seq: number }>(
        [{ $match: tombstoneFilter }, { $group: { _id: "$userId", seq: { $max: "$changeSeq" } } }],
        inSession(client),
      )
      .toArray();
    for (const horizon of horizons) {
      await collection(client, "users").updateOne(
        { _id: horizon._id },
        { $max: { tombstonePurgeSeq: horizon.seq } },
        inSession(client),
      );
    }
    await phrases.deleteMany(tombstoneFilter, inSession(client));
    await collection(client, "syncMutations").deleteMany(
      { createdAt: { $lt: new Date(now.getTime() - MUTATION_RECEIPT_RETENTION_MILLISECONDS) } },
      inSession(client),
    );
  });
}
