import {
  MAX_SYNC_MUTATIONS,
  type PhraseContent,
  type PhraseRecord,
  phraseContentSchema,
  type SyncedPreferences,
  type SyncMutation,
  syncMutationSchema,
  type SyncRequest,
  type SyncResponse,
} from "@lingobridge/contracts/account";
import type { SavedPhrase } from "./saved-phrases";

/**
 * Local-first phrase synchronization, written as pure functions over plain data so every rule is
 * testable without Chrome. The extension's local store stays the source of truth for the device:
 * a phrase is committed locally first, then described to the server as an idempotent mutation.
 *
 * Only phrases the user explicitly saved ever reach this module, and only the approved preference
 * fields are compared. Nothing about pages, permissions, or unsaved translations exists here.
 */

export const MAX_OUTBOX = 500;
const BASE_RETRY_MILLISECONDS = 30_000;
const MAX_RETRY_MILLISECONDS = 30 * 60_000;

export interface KnownPhrase {
  fingerprint: string;
  revision: number;
}

export interface SyncState {
  cursor: string | null;
  failures: number;
  /** Server revision and content fingerprint of every phrase this device has synchronized. */
  known: Record<string, KnownPhrase>;
  lastError: string | null;
  lastSyncedAt: string | null;
  nextAttemptAt: string | null;
  outbox: SyncMutation[];
  phraseSyncEnabled: boolean;
  preferences: {
    preferredTargetLanguage: string | null;
    processingPreference: SyncedPreferences["processingPreference"];
    revision: number;
  } | null;
  /** Ids seen so far during a full resynchronization that spans several pages. */
  resyncSeen: string[] | null;
}

export const INITIAL_SYNC_STATE: SyncState = {
  cursor: null,
  failures: 0,
  known: {},
  lastError: null,
  lastSyncedAt: null,
  nextAttemptAt: null,
  outbox: [],
  phraseSyncEnabled: true,
  preferences: null,
  resyncSeen: null,
};

export type IdFactory = () => string;

function toContent(phrase: SavedPhrase): PhraseContent | null {
  const parsed = phraseContentSchema.safeParse({
    id: phrase.id,
    note: phrase.note ?? null,
    provider: ["on-device", "google", "nvidia"].includes(phrase.provider)
      ? phrase.provider
      : "unknown",
    savedAt: phrase.savedAt,
    sourceLanguage: phrase.sourceLanguage,
    sourceText: phrase.sourceText,
    targetLanguage: phrase.targetLanguage,
    translatedText: phrase.translatedText,
  });
  return parsed.success ? parsed.data : null;
}

export interface FingerprintInput {
  note?: string | null;
  sourceLanguage: string;
  sourceText: string;
  targetLanguage: string;
  translatedText: string;
}

export function fingerprintPhrase(phrase: FingerprintInput): string {
  return JSON.stringify([
    phrase.sourceLanguage,
    phrase.targetLanguage,
    phrase.sourceText,
    phrase.translatedText,
    phrase.note?.trim() ? phrase.note : null,
  ]);
}

function sameContent(
  left: Pick<SavedPhrase, "sourceText" | "translatedText" | "sourceLanguage" | "targetLanguage">,
  right: typeof left,
): boolean {
  return (
    left.sourceText === right.sourceText &&
    left.translatedText === right.translatedText &&
    left.sourceLanguage === right.sourceLanguage &&
    left.targetLanguage === right.targetLanguage
  );
}

function mutationPhraseId(mutation: SyncMutation): string | null {
  if (mutation.kind === "upsert-phrase") return mutation.phrase.id;
  if (mutation.kind === "delete-phrase") return mutation.phraseId;
  return null;
}

/** Keeps at most one pending mutation per phrase; a newer local change replaces an older one. */
function enqueue(outbox: readonly SyncMutation[], mutation: SyncMutation): SyncMutation[] {
  const phraseId = mutationPhraseId(mutation);
  const filtered = outbox.filter((entry) =>
    phraseId === null ? entry.kind !== mutation.kind : mutationPhraseId(entry) !== phraseId,
  );
  return [...filtered, mutation].slice(-MAX_OUTBOX);
}

export function toSavedPhrase(record: Extract<PhraseRecord, { state: "live" }>): SavedPhrase {
  return {
    id: record.id,
    ...(record.note ? { note: record.note } : {}),
    provider: record.provider,
    savedAt: record.savedAt,
    sourceLanguage: record.sourceLanguage,
    sourceText: record.sourceText,
    targetLanguage: record.targetLanguage,
    translatedText: record.translatedText,
  };
}

/**
 * Compares the local store with what was last synchronized and queues the difference: new or
 * edited phrases become upserts against their known revision, and removed phrases become deletes.
 */
export function queueLocalChanges(
  state: SyncState,
  phrases: readonly SavedPhrase[],
  preferredTargetLanguage: string | null,
  newId: IdFactory,
): SyncState {
  let outbox = [...state.outbox];
  const localIds = new Set<string>();

  if (state.phraseSyncEnabled) {
    for (const phrase of phrases) {
      localIds.add(phrase.id);
      const known = state.known[phrase.id];
      const fingerprint = fingerprintPhrase(phrase);
      if (known?.fingerprint === fingerprint) continue;
      const pending = outbox.find((mutation) => mutationPhraseId(mutation) === phrase.id);
      if (pending?.kind === "upsert-phrase" && fingerprintPhrase(pending.phrase) === fingerprint) {
        continue;
      }
      const content = toContent(phrase);
      if (!content) continue;
      outbox = enqueue(outbox, {
        baseRevision: known?.revision ?? 0,
        kind: "upsert-phrase",
        mutationId: newId(),
        phrase: content,
      });
    }
  } else {
    for (const phrase of phrases) localIds.add(phrase.id);
  }

  for (const id of Object.keys(state.known)) {
    if (localIds.has(id)) continue;
    const pending = outbox.find((mutation) => mutationPhraseId(mutation) === id);
    if (pending?.kind === "delete-phrase") continue;
    outbox = enqueue(outbox, {
      baseRevision: state.known[id]?.revision ?? 0,
      kind: "delete-phrase",
      mutationId: newId(),
      phraseId: id,
    });
  }

  if (state.preferences && preferredTargetLanguage !== state.preferences.preferredTargetLanguage) {
    const pending = outbox.find((mutation) => mutation.kind === "update-preferences");
    const alreadyQueued =
      pending?.kind === "update-preferences" &&
      pending.preferences.preferredTargetLanguage === preferredTargetLanguage;
    if (!alreadyQueued) {
      outbox = enqueue(outbox, {
        baseRevision: state.preferences.revision,
        kind: "update-preferences",
        mutationId: newId(),
        preferences: {
          preferredTargetLanguage,
          processingPreference: state.preferences.processingPreference,
        },
      });
    }
  }

  return { ...state, outbox };
}

export function buildSyncRequest(state: SyncState): SyncRequest {
  return { cursor: state.cursor, mutations: state.outbox.slice(0, MAX_SYNC_MUTATIONS) };
}

export interface SyncApplication {
  phrases: SavedPhrase[];
  /** Set when the server's preferred language should replace the device's. */
  preferredTargetLanguage: string | null | undefined;
  state: SyncState;
}

/**
 * Applies one server response. Rules:
 * - Acknowledged mutations leave the outbox and record the server revision.
 * - A tombstone always wins: the phrase is removed locally and any pending edit is dropped.
 * - A stale update adopts the server record when content matches. When content differs, both
 *   versions are kept: the server's under the original id and the local one as a new phrase.
 * - Server changes never overwrite a phrase that still has an unsent local edit.
 */
export function applySyncResponse(
  state: SyncState,
  localPhrases: readonly SavedPhrase[],
  sent: SyncRequest,
  response: SyncResponse,
  now: Date,
  newId: IdFactory,
): SyncApplication {
  const phrases = new Map(localPhrases.map((phrase) => [phrase.id, phrase]));
  const known = { ...state.known };
  const acknowledged = new Set(response.results.map((result) => result.mutationId));
  let outbox = state.outbox.filter((mutation) => !acknowledged.has(mutation.mutationId));
  let preferences = state.preferences;
  let preferredTargetLanguage: string | null | undefined;
  let lastError: string | null = null;
  const sentById = new Map(sent.mutations.map((mutation) => [mutation.mutationId, mutation]));

  const removeLocal = (id: string) => {
    phrases.delete(id);
    delete known[id];
    outbox = outbox.filter((mutation) => mutationPhraseId(mutation) !== id);
  };
  const adoptLive = (record: Extract<PhraseRecord, { state: "live" }>) => {
    const saved = toSavedPhrase(record);
    phrases.set(record.id, saved);
    known[record.id] = { fingerprint: fingerprintPhrase(saved), revision: record.revision };
  };

  for (const result of response.results) {
    const mutation = sentById.get(result.mutationId);
    if (!mutation) continue;

    if (mutation.kind === "update-preferences") {
      if (result.preferences) {
        preferences = {
          preferredTargetLanguage: result.preferences.preferredTargetLanguage,
          processingPreference: result.preferences.processingPreference,
          revision: result.preferences.revision,
        };
        if (result.status === "conflict")
          preferredTargetLanguage = result.preferences.preferredTargetLanguage;
      }
      continue;
    }

    if (result.status === "rejected") {
      if (mutation.kind === "upsert-phrase") delete known[mutation.phrase.id];
      lastError =
        result.reason === "limit-reached"
          ? "This account has reached its synced phrase limit. New phrases stay on this device."
          : "Phrase sync is turned off for this account.";
      continue;
    }

    const record = result.phrase;
    if (mutation.kind === "delete-phrase") {
      delete known[mutation.phraseId];
      continue;
    }

    const id = mutation.phrase.id;
    if (result.status === "applied") {
      if (record?.state === "live") {
        const local = phrases.get(id);
        // Keep a newer local edit made while the request was in flight; it is already queued.
        if (local && fingerprintPhrase(local) !== fingerprintPhrase(mutation.phrase)) {
          known[id] = {
            fingerprint: fingerprintPhrase(mutation.phrase),
            revision: record.revision,
          };
        } else {
          adoptLive(record);
        }
      }
      continue;
    }

    // Conflict.
    if (!record || record.state === "deleted") {
      removeLocal(id);
      continue;
    }
    const local = phrases.get(id);
    if (local && !sameContent(local, record)) {
      const forkId = newId();
      phrases.set(forkId, { ...local, id: forkId });
    }
    adoptLive(record);
  }

  const seen = response.fullResync ? new Set<string>() : new Set(state.resyncSeen ?? []);
  const resyncing = response.fullResync || state.resyncSeen !== null;

  for (const record of response.changes.phrases) {
    if (resyncing) seen.add(record.id);
    if (record.state === "deleted") {
      removeLocal(record.id);
      continue;
    }
    if (outbox.some((mutation) => mutationPhraseId(mutation) === record.id)) continue;
    adoptLive(record);
  }

  let resyncSeen: string[] | null = resyncing ? [...seen] : null;
  if (resyncing && !response.hasMore) {
    // Anything this device synchronized before, but the server no longer has, was deleted
    // elsewhere while tombstones were purged. Never-synced local phrases are left to be uploaded.
    for (const id of Object.keys(known)) {
      if (!seen.has(id) && !outbox.some((mutation) => mutationPhraseId(mutation) === id)) {
        removeLocal(id);
      }
    }
    resyncSeen = null;
  }

  if (response.changes.preferences) {
    const server = response.changes.preferences;
    const hasPendingPreferences = outbox.some((mutation) => mutation.kind === "update-preferences");
    preferences = {
      preferredTargetLanguage: server.preferredTargetLanguage,
      processingPreference: server.processingPreference,
      revision: server.revision,
    };
    if (!hasPendingPreferences) preferredTargetLanguage = server.preferredTargetLanguage;
  }
  if (!preferences)
    preferences = { preferredTargetLanguage: null, processingPreference: null, revision: 0 };

  return {
    phrases: [...phrases.values()],
    preferredTargetLanguage,
    state: {
      ...state,
      cursor: response.cursor,
      failures: 0,
      known,
      lastError,
      lastSyncedAt: now.toISOString(),
      nextAttemptAt: null,
      outbox,
      phraseSyncEnabled: response.phraseSyncEnabled,
      preferences,
      resyncSeen,
    },
  };
}

/** Exponential backoff with jitter, capped, for offline and retryable failures. */
export function scheduleRetry(
  state: SyncState,
  now: Date,
  message: string,
  random: () => number = Math.random,
): SyncState {
  const failures = state.failures + 1;
  const base = Math.min(MAX_RETRY_MILLISECONDS, BASE_RETRY_MILLISECONDS * 2 ** (failures - 1));
  const delay = Math.round(base * (0.8 + random() * 0.4));
  return {
    ...state,
    failures,
    lastError: message,
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
  };
}

export function normalizeSyncState(value: unknown): SyncState {
  if (!value || typeof value !== "object") return INITIAL_SYNC_STATE;
  const candidate = value as Partial<SyncState>;
  return {
    cursor:
      typeof candidate.cursor === "string" && /^r?\d{1,19}$/u.test(candidate.cursor)
        ? candidate.cursor
        : null,
    failures:
      Number.isSafeInteger(candidate.failures) && (candidate.failures ?? 0) >= 0
        ? (candidate.failures as number)
        : 0,
    known: Object.fromEntries(
      Object.entries(
        candidate.known && typeof candidate.known === "object" ? candidate.known : {},
      ).filter(
        ([, entry]) =>
          Boolean(entry) &&
          typeof (entry as KnownPhrase).fingerprint === "string" &&
          Number.isSafeInteger((entry as KnownPhrase).revision),
      ),
    ),
    lastError: typeof candidate.lastError === "string" ? candidate.lastError : null,
    lastSyncedAt: typeof candidate.lastSyncedAt === "string" ? candidate.lastSyncedAt : null,
    nextAttemptAt: typeof candidate.nextAttemptAt === "string" ? candidate.nextAttemptAt : null,
    // A stored mutation that no longer matches the contract would make every request fail.
    outbox: Array.isArray(candidate.outbox)
      ? candidate.outbox
          .flatMap((entry) => {
            const parsed = syncMutationSchema.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
          })
          .slice(-MAX_OUTBOX)
      : [],
    phraseSyncEnabled: candidate.phraseSyncEnabled !== false,
    preferences: candidate.preferences ?? null,
    resyncSeen: Array.isArray(candidate.resyncSeen) ? candidate.resyncSeen : null,
  };
}
