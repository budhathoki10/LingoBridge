export interface WordToken {
  isWord: boolean;
  text: string;
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
