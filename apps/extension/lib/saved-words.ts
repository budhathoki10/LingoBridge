import { languageCodeSchema, wordUnderstandingResultSchema } from "@lingobridge/contracts";

export const SAVED_WORDS_STORAGE_KEY = "lingobridgeSavedWords";
export const MAX_SAVED_WORDS = 500;

export interface SavedWord {
  contextMeaning: string;
  example: string;
  id: string;
  meaning: string;
  partOfSpeech: string;
  pronunciation: string | null;
  savedAt: string;
  sourceLanguage: string;
  sourceText: string;
  targetLanguage: string;
  translation: string;
  word: string;
}

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function normalize(value: unknown): SavedWord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedWord>;
  const result = wordUnderstandingResultSchema.safeParse({
    contextMeaning: candidate.contextMeaning,
    example: candidate.example,
    meaning: candidate.meaning,
    partOfSpeech: candidate.partOfSpeech,
    pronunciation: candidate.pronunciation ?? null,
    provider: "nvidia",
    requestId: crypto.randomUUID(),
    translation: candidate.translation,
    word: candidate.word,
  });
  if (
    !result.success ||
    typeof candidate.id !== "string" ||
    typeof candidate.savedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.savedAt)) ||
    typeof candidate.sourceText !== "string" ||
    !languageCodeSchema.safeParse(candidate.sourceLanguage).success ||
    !languageCodeSchema.safeParse(candidate.targetLanguage).success
  ) {
    return null;
  }
  const { provider: _, requestId: __, ...details } = result.data;
  return {
    ...details,
    id: candidate.id,
    savedAt: new Date(candidate.savedAt).toISOString(),
    sourceLanguage: candidate.sourceLanguage as string,
    sourceText: (candidate.sourceText as string).trim(),
    targetLanguage: candidate.targetLanguage as string,
  };
}

export function normalizeSavedWords(value: unknown): SavedWord[] {
  if (!Array.isArray(value)) return [];
  const words = new Map<string, SavedWord>();
  for (const item of value) {
    const word = normalize(item);
    if (word && !words.has(word.id)) words.set(word.id, word);
  }
  return [...words.values()]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, MAX_SAVED_WORDS);
}

function storage(): StorageArea | undefined {
  const runtime = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: StorageArea } };
  };
  return runtime.chrome?.storage?.local;
}

export async function saveWord(word: SavedWord): Promise<SavedWord[]> {
  const area = storage();
  const current = area
    ? normalizeSavedWords((await area.get(SAVED_WORDS_STORAGE_KEY))[SAVED_WORDS_STORAGE_KEY])
    : [];
  const next = normalizeSavedWords([
    word,
    ...current.filter(
      (entry) =>
        !(
          entry.word.toLocaleLowerCase() === word.word.toLocaleLowerCase() &&
          entry.sourceLanguage === word.sourceLanguage &&
          entry.targetLanguage === word.targetLanguage
        ),
    ),
  ]);
  if (area) await area.set({ [SAVED_WORDS_STORAGE_KEY]: next });
  return next;
}
