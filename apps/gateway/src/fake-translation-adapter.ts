import { translationResultSchema, type TranslationRequest } from "@lingobridge/contracts";
import { TranslationAdapterError, type TranslationAdapter } from "./translation-adapter.js";

const exactTranslations = new Map<string, string>([
  ["en:ne:hello, how are you?", "नमस्ते, तपाईंलाई कस्तो छ?"],
  ["ne:en:नमस्ते, तपाईंलाई कस्तो छ?", "Hello, how are you?"],
  ["en:es:thank you", "Gracias"],
  ["es:en:gracias", "Thank you"],
  ["en:fr:good morning", "Bonjour"],
  ["fr:en:bonjour", "Good morning"],
]);

function normalizeText(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();
}

function inferLanguage(text: string): string {
  if (/[֐-׿]/u.test(text)) return "he";
  if (/[؀-ۿ]/u.test(text)) return "ar";
  if (/[ऀ-ॿ]/u.test(text)) return "ne";
  if (/[฀-๿]/u.test(text)) return "th";
  if (/[぀-ヿ]/u.test(text)) return "ja";
  if (/[㐀-鿿]/u.test(text)) return "zh-CN";
  if (/[Ѐ-ӿ]/u.test(text)) return "ru";
  return "en";
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Translation cancelled", "AbortError"));
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);

    function handleAbort() {
      globalThis.clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      reject(new DOMException("Translation cancelled", "AbortError"));
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export class FakeTranslationAdapter implements TranslationAdapter {
  constructor(private readonly delayMilliseconds = 220) {}

  async translate(request: TranslationRequest, signal: AbortSignal) {
    await wait(this.delayMilliseconds, signal);

    const normalizedSource = normalizeText(request.text);
    if (normalizedSource === "simulate failure") {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "The fake translation adapter is temporarily unavailable.",
      );
    }

    const detectedSourceLanguage =
      request.sourceLanguage === "auto" ? inferLanguage(request.text) : request.sourceLanguage;
    const key = `${detectedSourceLanguage}:${request.targetLanguage}:${normalizedSource}`;

    return translationResultSchema.parse({
      detectedSourceLanguage,
      provider: "google",
      requestId: request.requestId,
      targetLanguage: request.targetLanguage,
      translatedText:
        exactTranslations.get(key) ??
        `[Fake ${request.targetLanguage} translation]\n\n${request.text.trim()}`,
      warnings: [],
    });
  }
}
