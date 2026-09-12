import {
  languageCodeSchema,
  MAX_TRANSLATION_CODE_POINTS,
  providerSchema,
} from "@lingobridge/contracts";

/**
 * Phrases the user explicitly chose to keep. Nothing reaches this store on its own: a result that
 * is merely shown, or closed, is never saved. The page URL is deliberately not recorded, because
 * the phrase text alone is what the user asked to keep and a browsing trail is not.
 */
export interface SavedPhrase {
  id: string;
  provider: string;
  savedAt: string;
  sourceLanguage: string;
  sourceText: string;
  targetLanguage: string;
  translatedText: string;
}

export const SAVED_PHRASES_STORAGE_KEY = "lingobridgeSavedPhrases";
export const MAX_SAVED_PHRASES = 500;

interface ExtensionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  return Array.from(text).length > MAX_TRANSLATION_CODE_POINTS ? null : text;
}

function cleanLanguage(value: unknown): string | null {
  return typeof value === "string" && languageCodeSchema.safeParse(value).success ? value : null;
}

function cleanTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizePhrase(value: unknown): SavedPhrase | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedPhrase>;

  const sourceText = cleanText(candidate.sourceText);
  const translatedText = cleanText(candidate.translatedText);
  const sourceLanguage = cleanLanguage(candidate.sourceLanguage);
  const targetLanguage = cleanLanguage(candidate.targetLanguage);
  const savedAt = cleanTimestamp(candidate.savedAt);
  if (!sourceText || !translatedText || !sourceLanguage || !targetLanguage || !savedAt) return null;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null;

  return {
    id: candidate.id,
    provider: providerSchema.safeParse(candidate.provider).success
      ? (candidate.provider as string)
      : "unknown",
    savedAt,
    sourceLanguage,
    sourceText,
    targetLanguage,
    translatedText,
  };
}

/** Newest first, malformed records dropped, duplicate ids collapsed, and the list bounded. */
export function normalizeSavedPhrases(value: unknown): SavedPhrase[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, SavedPhrase>();
  for (const entry of value) {
    const phrase = normalizePhrase(entry);
    if (phrase && !byId.has(phrase.id)) byId.set(phrase.id, phrase);
  }
  return [...byId.values()]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, MAX_SAVED_PHRASES);
}

export function searchSavedPhrases(phrases: readonly SavedPhrase[], query: string): SavedPhrase[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [...phrases];
  return phrases.filter(
    (phrase) =>
      phrase.sourceText.toLocaleLowerCase().includes(needle) ||
      phrase.translatedText.toLocaleLowerCase().includes(needle),
  );
}

/**
 * Saving the same direction and source text twice replaces the older record rather than growing
 * the list, so repeatedly looking a word up does not bury everything else.
 */
export function addSavedPhrase(
  phrases: readonly SavedPhrase[],
  phrase: SavedPhrase,
): SavedPhrase[] {
  const normalized = normalizePhrase(phrase);
  if (!normalized) return [...phrases];
  const duplicate = (existing: SavedPhrase) =>
    existing.id === normalized.id ||
    (existing.sourceText === normalized.sourceText &&
      existing.sourceLanguage === normalized.sourceLanguage &&
      existing.targetLanguage === normalized.targetLanguage);
  return normalizeSavedPhrases([normalized, ...phrases.filter((entry) => !duplicate(entry))]);
}

export function removeSavedPhrase(phrases: readonly SavedPhrase[], id: string): SavedPhrase[] {
  return phrases.filter((phrase) => phrase.id !== id);
}

export function serializeSavedPhrases(phrases: readonly SavedPhrase[]): string {
  return `${JSON.stringify(
    { exportedAt: new Date().toISOString(), phrases, version: 1 },
    null,
    2,
  )}\n`;
}

export function createSavedPhraseRepository(storage: ExtensionStorageArea) {
  return {
    async load(): Promise<SavedPhrase[]> {
      const stored = await storage.get(SAVED_PHRASES_STORAGE_KEY);
      return normalizeSavedPhrases(stored[SAVED_PHRASES_STORAGE_KEY]);
    },
    async replace(phrases: readonly SavedPhrase[]): Promise<SavedPhrase[]> {
      const normalized = normalizeSavedPhrases(phrases);
      await storage.set({ [SAVED_PHRASES_STORAGE_KEY]: normalized });
      return normalized;
    },
  };
}

function extensionStorage(): ExtensionStorageArea | undefined {
  const runtime = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: ExtensionStorageArea } };
  };
  return runtime.chrome?.storage?.local;
}

export async function loadSavedPhrases(): Promise<SavedPhrase[]> {
  const storage = extensionStorage();
  if (!storage) return [];
  return createSavedPhraseRepository(storage).load();
}

export async function saveSavedPhrases(phrases: readonly SavedPhrase[]): Promise<SavedPhrase[]> {
  const storage = extensionStorage();
  if (!storage) return normalizeSavedPhrases(phrases);
  return createSavedPhraseRepository(storage).replace(phrases);
}

export async function savePhrase(phrase: SavedPhrase): Promise<SavedPhrase[]> {
  return saveSavedPhrases(addSavedPhrase(await loadSavedPhrases(), phrase));
}
