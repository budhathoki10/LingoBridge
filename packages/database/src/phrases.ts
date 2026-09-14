import type {
  LivePhraseRecord,
  PhraseRecord,
  ProcessingPreference,
  SyncedPreferences,
} from "@lingobridge/contracts/account";
import { type SqlClient, toInteger, toIsoString, toNullableIsoString } from "./client.js";

export interface PhraseRow {
  deleted_at: unknown;
  id: string;
  note: string | null;
  provider: string | null;
  revision: unknown;
  saved_at: unknown;
  source_language: string | null;
  source_text: string | null;
  target_language: string | null;
  translated_text: string | null;
  updated_at: unknown;
}

export const PHRASE_COLUMNS = `id, source_text, translated_text, source_language, target_language,
  provider, note, saved_at, updated_at, revision, deleted_at`;

export function toPhraseRecord(row: PhraseRow): PhraseRecord {
  if (row.deleted_at !== null && row.deleted_at !== undefined) {
    return {
      deletedAt: toIsoString(row.deleted_at),
      id: row.id,
      revision: toInteger(row.revision),
      state: "deleted",
    };
  }
  return {
    id: row.id,
    note: row.note,
    provider: row.provider as LivePhraseRecord["provider"],
    revision: toInteger(row.revision),
    savedAt: toIsoString(row.saved_at),
    sourceLanguage: row.source_language ?? "",
    sourceText: row.source_text ?? "",
    state: "live",
    targetLanguage: row.target_language ?? "",
    translatedText: row.translated_text ?? "",
    updatedAt: toIsoString(row.updated_at),
  };
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/** Every read is scoped by the authenticated user id; filters only ever narrow that set. */
export async function listPhrases(
  client: SqlClient,
  userId: string,
  filters: PhraseFilters,
): Promise<PhrasePage> {
  const conditions = ["user_id = $1", "deleted_at is null"];
  const params: unknown[] = [userId];
  const add = (condition: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    conditions.push(condition(`$${params.length}`));
  };

  const query = filters.query?.trim();
  if (query) {
    add(
      (p) => `(source_text ilike ${p} escape '\\' or translated_text ilike ${p} escape '\\')`,
      `%${escapeLike(query)}%`,
    );
  }
  if (filters.sourceLanguage) add((p) => `source_language = ${p}`, filters.sourceLanguage);
  if (filters.targetLanguage) add((p) => `target_language = ${p}`, filters.targetLanguage);
  if (filters.savedFrom) add((p) => `saved_at >= ${p}`, filters.savedFrom);
  if (filters.savedTo) add((p) => `saved_at < ${p}`, filters.savedTo);

  const where = conditions.join(" and ");
  const countResult = await client.query<{ total: unknown }>(
    `select count(*) as total from phrases where ${where}`,
    params,
  );
  const { rows } = await client.query<PhraseRow>(
    `select ${PHRASE_COLUMNS} from phrases where ${where}
      order by saved_at ${filters.sort === "oldest" ? "asc" : "desc"}, id
      limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, filters.limit, filters.offset],
  );
  return {
    phrases: rows.map(toPhraseRecord).filter((record) => record.state === "live"),
    total: toInteger(countResult.rows[0]?.total ?? 0),
  };
}

export async function getPhraseRecord(
  client: SqlClient,
  userId: string,
  phraseId: string,
): Promise<PhraseRecord | null> {
  const { rows } = await client.query<PhraseRow>(
    `select ${PHRASE_COLUMNS} from phrases where user_id = $1 and id = $2`,
    [userId, phraseId],
  );
  return rows[0] ? toPhraseRecord(rows[0]) : null;
}

export interface PhraseLanguageSummary {
  sourceLanguages: string[];
  targetLanguages: string[];
  total: number;
}

export async function summarizePhraseLanguages(
  client: SqlClient,
  userId: string,
): Promise<PhraseLanguageSummary> {
  const { rows } = await client.query<{
    source_language: string;
    target_language: string;
    total: unknown;
  }>(
    `select source_language, target_language, count(*) as total from phrases
      where user_id = $1 and deleted_at is null
      group by source_language, target_language`,
    [userId],
  );
  return {
    sourceLanguages: [...new Set(rows.map((row) => row.source_language))].sort(),
    targetLanguages: [...new Set(rows.map((row) => row.target_language))].sort(),
    total: rows.reduce((sum, row) => sum + toInteger(row.total), 0),
  };
}

interface PreferencesRow {
  phrase_sync_enabled: boolean;
  preferred_target_language: string | null;
  processing_preference: ProcessingPreference | null;
  revision: unknown;
  updated_at: unknown;
}

export const PREFERENCE_COLUMNS =
  "preferred_target_language, processing_preference, phrase_sync_enabled, revision, updated_at";

export function toSyncedPreferences(row: PreferencesRow): SyncedPreferences {
  return {
    phraseSyncEnabled: row.phrase_sync_enabled,
    preferredTargetLanguage: row.preferred_target_language,
    processingPreference: row.processing_preference,
    revision: toInteger(row.revision),
    updatedAt: toNullableIsoString(row.updated_at),
  };
}

export const DEFAULT_PREFERENCES: SyncedPreferences = {
  phraseSyncEnabled: true,
  preferredTargetLanguage: null,
  processingPreference: null,
  revision: 0,
  updatedAt: null,
};

export async function getPreferences(
  client: SqlClient,
  userId: string,
): Promise<SyncedPreferences> {
  const { rows } = await client.query<PreferencesRow>(
    `select ${PREFERENCE_COLUMNS} from preferences where user_id = $1`,
    [userId],
  );
  return rows[0] ? toSyncedPreferences(rows[0]) : DEFAULT_PREFERENCES;
}
