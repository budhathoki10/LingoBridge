import { describe, expect, it } from "vitest";
import {
  isClickableWord,
  tokenizeWords,
  wordUnderstandingCacheKey,
} from "../../apps/extension/lib/word-understanding";
import { normalizeSavedWords } from "../../apps/extension/lib/saved-words";

describe("word understanding helpers", () => {
  it("keeps punctuation outside interactive words", () => {
    const tokens = tokenizeWords('The "deployment," worked.');
    expect(tokens.filter((token) => token.isWord).map((token) => token.text)).toEqual([
      "The",
      "deployment",
      "worked",
    ]);
  });

  it("keys the cache by word, context, and language direction", () => {
    const input = {
      sourceLanguage: "en",
      sourceText: "A server runs.",
      targetLanguage: "ne",
      word: "runs",
    };
    expect(wordUnderstandingCacheKey(input)).toBe(
      wordUnderstandingCacheKey({ ...input, word: "RUNS" }),
    );
    expect(wordUnderstandingCacheKey(input)).not.toBe(
      wordUnderstandingCacheKey({ ...input, sourceText: "A child runs." }),
    );
  });

  it("normalizes explicitly saved words and rejects malformed entries", () => {
    expect(normalizeSavedWords([{ id: "bad" }])).toEqual([]);
  });

  it("skips common English words but keeps complex or specific ones clickable", () => {
    expect(isClickableWord("is", "en")).toBe(false);
    expect(isClickableWord("a", "en")).toBe(false);
    expect(isClickableWord("for", "en")).toBe(false);
    expect(isClickableWord("Lamborghini", "en")).toBe(true);
    expect(isClickableWord("headquartered", "en")).toBe(true);
    expect(isClickableWord("iconic", "en")).toBe(true);
  });

  it("is case-insensitive for both the word and the language code", () => {
    expect(isClickableWord("Is", "en")).toBe(false);
    expect(isClickableWord("IS", "EN")).toBe(false);
    expect(isClickableWord("Lamborghini", "EN")).toBe(true);
  });

  it("keeps every word clickable outside English source text", () => {
    expect(isClickableWord("is", "fr")).toBe(true);
    expect(isClickableWord("a", "ne")).toBe(true);
    expect(isClickableWord("is", undefined)).toBe(true);
    expect(isClickableWord("is", "")).toBe(true);
  });

  it("defaults an unrecognized English word to clickable", () => {
    expect(isClickableWord("lingobridgexyz", "en")).toBe(true);
  });
});
