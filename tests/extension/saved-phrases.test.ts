import { describe, expect, it } from "vitest";
import {
  addSavedPhrase,
  createSavedPhraseRepository,
  MAX_SAVED_PHRASES,
  normalizeSavedPhrases,
  removeSavedPhrase,
  type SavedPhrase,
  searchSavedPhrases,
  serializeSavedPhrases,
} from "../../apps/extension/lib/saved-phrases";

function phrase(overrides: Partial<SavedPhrase> = {}): SavedPhrase {
  return {
    id: "phrase-1",
    provider: "nvidia",
    savedAt: "2026-09-12T10:00:00.000Z",
    sourceLanguage: "en",
    sourceText: "Good morning",
    targetLanguage: "ne",
    translatedText: "शुभ प्रभात",
    ...overrides,
  };
}

describe("saved phrase records", () => {
  it("drops malformed records instead of failing the whole store", () => {
    expect(
      normalizeSavedPhrases([
        phrase(),
        null,
        "nonsense",
        phrase({ id: "", sourceText: "x" }),
        phrase({ id: "blank", sourceText: "   " }),
        phrase({ id: "bad-language", sourceLanguage: "not-a-language" }),
        phrase({ id: "bad-date", savedAt: "never" }),
      ]),
    ).toEqual([phrase()]);
  });

  it("collapses duplicate ids and orders newest first", () => {
    const records = normalizeSavedPhrases([
      phrase({ id: "older", savedAt: "2026-09-10T10:00:00.000Z" }),
      phrase({ id: "newer", savedAt: "2026-09-12T10:00:00.000Z" }),
      phrase({ id: "older", savedAt: "2026-01-01T10:00:00.000Z", sourceText: "ignored copy" }),
    ]);
    expect(records.map((record) => record.id)).toEqual(["newer", "older"]);
    expect(records[1]?.sourceText).toBe("Good morning");
  });

  it("labels an unrecognised provider rather than trusting it", () => {
    expect(normalizeSavedPhrases([phrase({ provider: "some-other-service" })])[0]?.provider).toBe(
      "unknown",
    );
  });

  it("bounds the store", () => {
    const many = Array.from({ length: MAX_SAVED_PHRASES + 25 }, (_, index) =>
      phrase({ id: `phrase-${index}` }),
    );
    expect(normalizeSavedPhrases(many)).toHaveLength(MAX_SAVED_PHRASES);
  });
});

describe("saving, searching and deleting", () => {
  it("replaces an earlier save of the same text and direction", () => {
    const first = addSavedPhrase([], phrase({ id: "a" }));
    const second = addSavedPhrase(first, phrase({ id: "b", translatedText: "नमस्ते" }));
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: "b", translatedText: "नमस्ते" });
  });

  it("keeps the same text saved separately for a different target language", () => {
    const withNepali = addSavedPhrase([], phrase({ id: "a", targetLanguage: "ne" }));
    const withHindi = addSavedPhrase(withNepali, phrase({ id: "b", targetLanguage: "hi" }));
    expect(withHindi).toHaveLength(2);
  });

  it("ignores an unusable phrase instead of storing it", () => {
    expect(addSavedPhrase([], phrase({ sourceText: "" }))).toEqual([]);
  });

  it("searches both sides of the phrase, case-insensitively", () => {
    const records = [
      phrase({ id: "a", sourceText: "Good morning", translatedText: "शुभ प्रभात" }),
      phrase({ id: "b", sourceText: "Thank you", translatedText: "धन्यवाद" }),
    ];
    expect(searchSavedPhrases(records, "MORNING").map((record) => record.id)).toEqual(["a"]);
    expect(searchSavedPhrases(records, "धन्यवाद").map((record) => record.id)).toEqual(["b"]);
    expect(searchSavedPhrases(records, "   ")).toHaveLength(2);
  });

  it("deletes only the requested record", () => {
    const records = [phrase({ id: "a" }), phrase({ id: "b", sourceText: "Thank you" })];
    expect(removeSavedPhrase(records, "a").map((record) => record.id)).toEqual(["b"]);
    expect(removeSavedPhrase(records, "missing")).toHaveLength(2);
  });

  it("exports readable JSON carrying every saved phrase", () => {
    const exported = JSON.parse(serializeSavedPhrases([phrase()])) as {
      phrases: SavedPhrase[];
      version: number;
    };
    expect(exported.version).toBe(1);
    expect(exported.phrases).toEqual([phrase()]);
  });
});

describe("saved phrase storage", () => {
  it("persists normalized records and reads them back", async () => {
    const values: Record<string, unknown> = {};
    const repository = createSavedPhraseRepository({
      async get(key) {
        return { [key]: values[key] };
      },
      async set(items) {
        Object.assign(values, items);
      },
    });

    await expect(repository.load()).resolves.toEqual([]);
    await repository.replace([phrase(), phrase({ id: "broken", sourceText: "" })]);
    await expect(repository.load()).resolves.toEqual([phrase()]);

    await repository.replace([]);
    await expect(repository.load()).resolves.toEqual([]);
  });
});
