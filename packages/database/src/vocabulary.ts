import { type SavedWordRecord, savedWordSchema } from "@lingobridge/contracts/account";
import type { Filter } from "mongodb";
import { collection, type DbClient, inSession, type VocabularyDocument } from "./client.js";

function toRecord(document: VocabularyDocument): SavedWordRecord {
  return savedWordSchema.parse({
    contextMeaning: document.contextMeaning,
    example: document.example,
    id: document.id,
    meaning: document.meaning,
    partOfSpeech: document.partOfSpeech,
    pronunciation: document.pronunciation,
    savedAt: document.savedAt.toISOString(),
    sourceLanguage: document.sourceLanguage,
    sourceText: document.sourceText,
    targetLanguage: document.targetLanguage,
    translation: document.translation,
    word: document.word,
  });
}

export async function upsertSavedWord(
  client: DbClient,
  userId: string,
  word: SavedWordRecord,
): Promise<SavedWordRecord> {
  const document: VocabularyDocument = { ...word, savedAt: new Date(word.savedAt), userId };
  await collection(client, "vocabulary").replaceOne({ id: word.id, userId }, document, {
    ...inSession(client),
    upsert: true,
  });
  return word;
}

function savedWordFilter(userId: string, query = ""): Filter<VocabularyDocument> {
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return {
    userId,
    ...(escaped
      ? {
          $or: [
            { word: { $options: "i", $regex: escaped } },
            { translation: { $options: "i", $regex: escaped } },
          ],
        }
      : {}),
  };
}

export interface SavedWordPage {
  total: number;
  words: SavedWordRecord[];
}

/** Bounded, user-scoped vocabulary page for the dashboard. */
export async function listSavedWordsPage(
  client: DbClient,
  userId: string,
  options: { limit: number; offset: number; query?: string },
): Promise<SavedWordPage> {
  const vocabulary = collection(client, "vocabulary");
  const filter = savedWordFilter(userId, options.query);
  const total = await vocabulary.countDocuments(filter, inSession(client));
  const documents = await vocabulary
    .find(filter, inSession(client))
    .sort([
      ["savedAt", -1],
      ["id", 1],
    ])
    .skip(options.offset)
    .limit(options.limit)
    .toArray();
  return { total, words: documents.map(toRecord) };
}

export async function countSavedWords(client: DbClient, userId: string): Promise<number> {
  return collection(client, "vocabulary").countDocuments({ userId }, inSession(client));
}

/** Full bounded list used by account and spreadsheet exports. */
export async function listSavedWords(
  client: DbClient,
  userId: string,
  query = "",
): Promise<SavedWordRecord[]> {
  const result = await listSavedWordsPage(client, userId, { limit: 500, offset: 0, query });
  return result.words;
}

export async function deleteSavedWords(
  client: DbClient,
  userId: string,
  ids: readonly string[],
): Promise<number> {
  const result = await collection(client, "vocabulary").deleteMany(
    { id: { $in: [...ids] }, userId },
    inSession(client),
  );
  return result.deletedCount;
}
