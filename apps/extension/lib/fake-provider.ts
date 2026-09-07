import { inferPreviewLanguage, type TextDirection } from "./capabilities";

export interface PreviewTranslationRequest {
  attempt: number;
  requestId: number;
  sourceLanguage: string;
  targetLanguage: string;
  targetLanguageName: string;
  targetTextDirection: TextDirection;
  text: string;
}

export interface PreviewTranslationResult {
  detectedSourceLanguage: string;
  provider: "preview";
  requestId: number;
  targetLanguage: string;
  targetTextDirection: TextDirection;
  translatedText: string;
}

export class PreviewProviderError extends Error {
  readonly retryable = true;

  constructor(message = "The preview provider could not finish this translation.") {
    super(message);
    this.name = "PreviewProviderError";
  }
}

const exactTranslations = new Map<string, string>([
  ["en:ne:hello, how are you?", "नमस्ते, तपाईंलाई कस्तो छ?"],
  ["ne:en:नमस्ते, तपाईंलाई कस्तो छ?", "Hello, how are you?"],
  ["en:es:thank you", "Gracias"],
  ["es:en:gracias", "Thank you"],
  ["en:fr:good morning", "Bonjour"],
  ["fr:en:bonjour", "Good morning"],
]);

function waitForPreview(milliseconds: number, signal: AbortSignal): Promise<void> {
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

function normalizedText(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();
}

export async function translateWithPreviewData(
  request: PreviewTranslationRequest,
  signal: AbortSignal,
): Promise<PreviewTranslationResult> {
  const delay = normalizedText(request.text).includes("slow preview") ? 1_100 : 520;
  await waitForPreview(delay, signal);

  if (normalizedText(request.text) === "simulate failure" && request.attempt === 1) {
    throw new PreviewProviderError();
  }

  const detectedSourceLanguage =
    request.sourceLanguage === "auto" ? inferPreviewLanguage(request.text) : request.sourceLanguage;
  const key = `${detectedSourceLanguage}:${request.targetLanguage}:${normalizedText(request.text)}`;
  const translatedText =
    exactTranslations.get(key) ??
    `Preview in ${request.targetLanguageName}\n\n${request.text.trim()}`;

  return {
    detectedSourceLanguage,
    provider: "preview",
    requestId: request.requestId,
    targetLanguage: request.targetLanguage,
    targetTextDirection: request.targetTextDirection,
    translatedText,
  };
}
