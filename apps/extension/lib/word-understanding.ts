import { COMMON_ENGLISH_WORDS } from "./common-english-words";

export interface WordToken {
  isWord: boolean;
  text: string;
}

/**
 * Whether a word from the original selected text is worth an explicit "understand this word"
 * button. Only English text is filtered today, because a curated common-word list only exists for
 * English; every other source language, and any word this function can't classify, stays
 * clickable, matching the extension's existing behavior.
 */
export function isClickableWord(word: string, sourceLanguage: string | undefined): boolean {
  if ((sourceLanguage ?? "").toLowerCase() !== "en") return true;
  return !COMMON_ENGLISH_WORDS.has(word.toLowerCase());
}

/** Uses Unicode word boundaries, preserving whitespace and punctuation as ordinary text. */
export function tokenizeWords(text: string, locale?: string): WordToken[] {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    return [...new Segmenter(locale, { granularity: "word" }).segment(text)].map((part) => ({
      isWord: Boolean(part.isWordLike),
      text: part.segment,
    }));
  }
  return text.split(/([\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*)/gu).map((part) => ({
    isWord: /^[\p{L}\p{M}\p{N}]/u.test(part),
    text: part,
  }));
}

export function wordUnderstandingCacheKey(input: {
  sourceLanguage: string;
  sourceText: string;
  targetLanguage: string;
  word: string;
}): string {
  return JSON.stringify([
    input.word.toLocaleLowerCase(),
    input.sourceText,
    input.sourceLanguage.toLocaleLowerCase(),
    input.targetLanguage.toLocaleLowerCase(),
  ]);
}
