import { type SavedWordRecord, savedWordSchema } from "@lingobridge/contracts/account";
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

export async function listSavedWords(
  client: DbClient,
  userId: string,
  query = "",
): Promise<SavedWordRecord[]> {
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const documents = await collection(client, "vocabulary")
    .find(
      {
        userId,
        ...(escaped
          ? {
              $or: [
                { word: { $options: "i", $regex: escaped } },
                { translation: { $options: "i", $regex: escaped } },
              ],
            }
          : {}),
      },
      inSession(client),
    )
    .sort({ savedAt: -1 })
    .limit(500)
    .toArray();
  return documents.map(toRecord);
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
