import {
  type ExplanationRequest,
  explanationResultSchema,
  type TransliterationRequest,
  transliterationResultSchema,
  type WordUnderstandingRequest,
  wordUnderstandingResultSchema,
} from "@lingobridge/contracts";
import type { ExplanationAdapter } from "./explanation-adapter.js";
import { TranslationAdapterError } from "./translation-adapter.js";

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Explanation cancelled", "AbortError"));
      return;
    }
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    function handleAbort() {
      globalThis.clearTimeout(timeout);
      reject(new DOMException("Explanation cancelled", "AbortError"));
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

/** Deterministic, offline stand-in so the extension and tests never call NVIDIA. */
export class FakeExplanationAdapter implements ExplanationAdapter {
  constructor(private readonly delayMilliseconds = 220) {}

  async explain(request: ExplanationRequest, signal: AbortSignal) {
    await wait(this.delayMilliseconds, signal);
    if (request.sourceText.trim().toLocaleLowerCase() === "simulate failure") {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "The fake explanation adapter is temporarily unavailable.",
      );
    }
    const phrase = request.sourceText.trim();
    return explanationResultSchema.parse({
      examples: [
        {
          source: `[Fake ${request.sourceLanguage} example] ${phrase}`,
          translation: `[Fake ${request.targetLanguage} example] ${request.translatedText.trim()}`,
        },
      ],
      meaning: `[Fake explanation in ${request.targetLanguage}] "${phrase}" means "${request.translatedText.trim()}".`,
      provider: "nvidia",
      register: "neutral",
      requestId: request.requestId,
      usageNote: "Simulated explanation. Live mode uses NVIDIA Nemotron 3 Ultra.",
    });
  }

  async transliterate(request: TransliterationRequest, signal: AbortSignal) {
    await wait(this.delayMilliseconds, signal);
    return transliterationResultSchema.parse({
      provider: "nvidia",
      requestId: request.requestId,
      text: `नेपाली ${request.text}`,
    });
  }

  async understandWord(request: WordUnderstandingRequest, signal: AbortSignal) {
    await wait(this.delayMilliseconds, signal);
    return wordUnderstandingResultSchema.parse({
      contextMeaning: `Here, “${request.word}” has the meaning used in this sentence.`,
      example: `This example uses ${request.word} in context.`,
      meaning: `A simple meaning of ${request.word}.`,
      partOfSpeech: "word",
      pronunciation: null,
      provider: "nvidia",
      requestId: request.requestId,
      translation: request.word,
      word: request.word,
    });
  }
}
