import { v3 } from "@google-cloud/translate";
import { type TranslationRequest, translationResultSchema } from "@lingobridge/contracts";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

export interface GoogleTranslateTextRequest {
  contents: string[];
  mimeType: "text/plain";
  model: string;
  parent: string;
  sourceLanguageCode?: string;
  targetLanguageCode: string;
}

export interface GoogleTranslateTextResponse {
  translations?: Array<{
    detectedLanguageCode?: string | null;
    translatedText?: string | null;
  }> | null;
}

export interface GoogleSupportedLanguagesRequest {
  displayLanguageCode: string;
  model: string;
  parent: string;
}

export interface GoogleSupportedLanguagesResponse {
  languages?: Array<{
    displayName?: string | null;
    languageCode?: string | null;
    supportSource?: boolean | null;
    supportTarget?: boolean | null;
  }> | null;
}

export interface GoogleCapabilityClient {
  getSupportedLanguages(
    request: GoogleSupportedLanguagesRequest,
    timeoutMilliseconds: number,
  ): Promise<GoogleSupportedLanguagesResponse>;
}

export interface GoogleTranslationClient {
  translateText(
    request: GoogleTranslateTextRequest,
    timeoutMilliseconds: number,
  ): Promise<GoogleTranslateTextResponse>;
}

export interface GoogleCloudClient extends GoogleCapabilityClient, GoogleTranslationClient {}

export function createGoogleCloudClient(): GoogleCloudClient {
  const client = new v3.TranslationServiceClient();

  return {
    async getSupportedLanguages(request, timeoutMilliseconds) {
      const [response] = await client.getSupportedLanguages(request, {
        retry: null,
        timeout: timeoutMilliseconds,
      });
      return response;
    },
    async translateText(request, timeoutMilliseconds) {
      const [response] = await client.translateText(request, {
        retry: null,
        timeout: timeoutMilliseconds,
      });
      return response;
    },
  };
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Translation cancelled", "AbortError"));

  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(new DOMException("Translation cancelled", "AbortError"));
    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", handleAbort));
  });
}

function providerError(error: unknown): TranslationAdapterError {
  const code =
    error && typeof error === "object" && "code" in error ? Reflect.get(error, "code") : undefined;

  if (code === 4 || code === "DEADLINE_EXCEEDED") {
    return new TranslationAdapterError("timeout", "Google translation timed out.");
  }

  const retryable = [
    8,
    10,
    13,
    14,
    "RESOURCE_EXHAUSTED",
    "ABORTED",
    "INTERNAL",
    "UNAVAILABLE",
  ].includes(code as never);
  return new TranslationAdapterError(
    "provider-unavailable",
    "Google translation is unavailable.",
    retryable,
  );
}

export class GoogleTranslationAdapter implements TranslationAdapter {
  private readonly model: string;
  private readonly parent: string;

  constructor(
    private readonly client: GoogleTranslationClient,
    projectId: string,
    private readonly timeoutMilliseconds: number,
  ) {
    this.parent = `projects/${projectId}/locations/global`;
    this.model = `${this.parent}/models/general/nmt`;
  }

  async translate(request: TranslationRequest, signal: AbortSignal) {
    let response: GoogleTranslateTextResponse;
    try {
      response = await abortable(
        this.client.translateText(
          {
            contents: [request.text],
            mimeType: "text/plain",
            model: this.model,
            parent: this.parent,
            ...(request.sourceLanguage === "auto"
              ? {}
              : { sourceLanguageCode: request.sourceLanguage }),
            targetLanguageCode: request.targetLanguage,
          },
          this.timeoutMilliseconds,
        ),
        signal,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw providerError(error);
    }

    const translation = response.translations?.[0];
    if (!translation?.translatedText?.trim()) {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "Google returned an empty translation.",
        true,
      );
    }

    return translationResultSchema.parse({
      detectedSourceLanguage:
        request.sourceLanguage === "auto"
          ? (translation.detectedLanguageCode ?? null)
          : request.sourceLanguage,
      provider: "google",
      requestId: request.requestId,
      targetLanguage: request.targetLanguage,
      translatedText: translation.translatedText,
      warnings: [],
    });
  }
}
