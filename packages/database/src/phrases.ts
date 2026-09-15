import type {
  LivePhraseRecord,
  PhraseRecord,
  SyncedPreferences,
} from "@lingobridge/contracts/account";
import type { Filter } from "mongodb";
import {
  collection,
  type DbClient,
  inSession,
  type PhraseDocument,
  type PreferencesDocument,
  toIsoString,
  toNullableIsoString,
} from "./client.js";

export function toPhraseRecord(document: PhraseDocument): PhraseRecord {
  if (document.deletedAt !== null && document.deletedAt !== undefined) {
    return {
      deletedAt: toIsoString(document.deletedAt),
      id: document.id,
      revision: document.revision,
      state: "deleted",
    };
  }
  return {
    id: document.id,
    note: document.note,
    provider: document.provider as LivePhraseRecord["provider"],
    revision: document.revision,
    savedAt: toIsoString(document.savedAt),
    sourceLanguage: document.sourceLanguage ?? "",
    sourceText: document.sourceText ?? "",
    state: "live",
    targetLanguage: document.targetLanguage ?? "",
    translatedText: document.translatedText ?? "",
    updatedAt: toIsoString(document.updatedAt),
  };
}

export function toLivePhraseRecords(documents: readonly PhraseDocument[]): LivePhraseRecord[] {
  return documents
    .map(toPhraseRecord)
    .filter((record): record is LivePhraseRecord => record.state === "live");
}

export interface PhraseFilters {
  limit: number;
  offset: number;
  query?: string;
  savedFrom?: Date;
  savedTo?: Date;
  sort?: "newest" | "oldest";
  sourceLanguage?: string;
  targetLanguage?: string;
}

export interface PhrasePage {
  phrases: LivePhraseRecord[];
  total: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Every read is scoped by the authenticated user id; filters only ever narrow that set. */
export async function listPhrases(
  client: DbClient,
  userId: string,
  filters: PhraseFilters,
): Promise<PhrasePage> {
  const filter: Filter<PhraseDocument> = { deletedAt: null, userId };

  const query = filters.query?.trim();
  if (query) {
    const pattern = { $options: "i", $regex: escapeRegex(query) };
    filter.$or = [{ sourceText: pattern }, { translatedText: pattern }];
  }
  if (filters.sourceLanguage) filter.sourceLanguage = filters.sourceLanguage;
  if (filters.targetLanguage) filter.targetLanguage = filters.targetLanguage;
  if (filters.savedFrom || filters.savedTo) {
    filter.savedAt = {
      ...(filters.savedFrom ? { $gte: filters.savedFrom } : {}),
      ...(filters.savedTo ? { $lt: filters.savedTo } : {}),
    };
  }

  const phrases = collection(client, "phrases");
  const total = await phrases.countDocuments(filter, inSession(client));
  const documents = await phrases
    .find(filter, inSession(client))
    // Array form: sort precedence must not depend on object key order.
    .sort([
      ["savedAt", filters.sort === "oldest" ? 1 : -1],
      ["id", 1],
    ])
    .skip(filters.offset)
    .limit(filters.limit)
    .toArray();
  return { phrases: toLivePhraseRecords(documents), total };
}

export async function getPhraseRecord(
  client: DbClient,
  userId: string,
  phraseId: string,
): Promise<PhraseRecord | null> {
  const document = await collection(client, "phrases").findOne(
    { id: phraseId, userId },
    inSession(client),
  );
  return document ? toPhraseRecord(document) : null;
}

export interface PhraseLanguageSummary {
  sourceLanguages: string[];
  targetLanguages: string[];
  total: number;
}

export async function summarizePhraseLanguages(
  client: DbClient,
  userId: string,
): Promise<PhraseLanguageSummary> {
  const groups = await collection(client, "phrases")
    .aggregate<{ _id: { source: string; target: string }; total: number }>(
      [
        { $match: { deletedAt: null, userId } },
        {
          $group: {
            _id: { source: "$sourceLanguage", target: "$targetLanguage" },
            total: { $sum: 1 },
          },
        },
      ],
      inSession(client),
    )
    .toArray();
  return {
    sourceLanguages: [...new Set(groups.map((group) => group._id.source))].sort(),
    targetLanguages: [...new Set(groups.map((group) => group._id.target))].sort(),
    total: groups.reduce((sum, group) => sum + group.total, 0),
  };
}

export function toSyncedPreferences(document: PreferencesDocument): SyncedPreferences {
  return {
    phraseSyncEnabled: document.phraseSyncEnabled,
    preferredTargetLanguage: document.preferredTargetLanguage,
    processingPreference: document.processingPreference,
    revision: document.revision,
    updatedAt: toNullableIsoString(document.updatedAt),
  };
}

export const DEFAULT_PREFERENCES: SyncedPreferences = {
  phraseSyncEnabled: true,
  preferredTargetLanguage: null,
  processingPreference: null,
  revision: 0,
  updatedAt: null,
};

export async function getPreferences(client: DbClient, userId: string): Promise<SyncedPreferences> {
  const document = await collection(client, "preferences").findOne(
    { _id: userId },
    inSession(client),
  );
  return document ? toSyncedPreferences(document) : DEFAULT_PREFERENCES;
}
