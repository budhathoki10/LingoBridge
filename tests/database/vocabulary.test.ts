import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteSavedWords,
  listSavedWords,
  openInMemoryDatabase,
  type Database,
  upsertSavedWord,
} from "../../packages/database/src";

let database: Database | null = null;

afterEach(async () => {
  await database?.close();
  database = null;
});

describe("saved vocabulary", () => {
  it("isolates, searches, replaces, and deletes user-owned words", async () => {
    database = await openInMemoryDatabase();
    const word = {
      contextMeaning: "Releasing the application for use.",
      example: "The deployment completed successfully.",
      id: randomUUID(),
      meaning: "Putting software where people can use it.",
      partOfSpeech: "noun",
      pronunciation: null,
      savedAt: "2026-09-16T12:00:00.000Z",
      sourceLanguage: "en",
      sourceText: "The team completed the deployment.",
      targetLanguage: "ne",
      translation: "परिनियोजन",
      word: "deployment",
    };
    await upsertSavedWord(database, "user-a", word);
    expect(await listSavedWords(database, "user-b")).toEqual([]);
    expect(await listSavedWords(database, "user-a", "परिनियोजन")).toHaveLength(1);
    await upsertSavedWord(database, "user-a", { ...word, meaning: "Updated meaning" });
    expect((await listSavedWords(database, "user-a"))[0]?.meaning).toBe("Updated meaning");
    expect(await deleteSavedWords(database, "user-a", [word.id])).toBe(1);
    expect(await listSavedWords(database, "user-a")).toEqual([]);
  });
});
