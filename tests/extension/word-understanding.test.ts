import { describe, expect, it } from "vitest";
import {
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
});
