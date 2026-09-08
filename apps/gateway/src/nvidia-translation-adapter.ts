import { type TranslationRequest, translationResultSchema } from "@lingobridge/contracts";
import { supportsNvidiaTranslationPair } from "./nvidia-capabilities.js";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

export interface NvidiaChatCompletionRequest {
  max_tokens: number;
  messages: Array<{ content: string; role: "system" | "user" }>;
  model: string;
  temperature: number;
  top_p: number;
}

export interface NvidiaChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }> | null;
}

export interface NvidiaTranslationClient {
  createChatCompletion(
    request: NvidiaChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<NvidiaChatCompletionResponse>;
}

export interface NvidiaClientOptions {
  apiKey: string;
  baseUrl: string;
}

export function createNvidiaTranslationClient({
  apiKey,
  baseUrl,
}: NvidiaClientOptions): NvidiaTranslationClient {
  const endpoint = new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  return {
    async createChatCompletion(request, signal) {
      const response = await fetch(endpoint, {
        body: JSON.stringify(request),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      });

      if (!response.ok) {
        throw Object.assign(new Error("NVIDIA translation request failed."), {
          status: response.status,
        });
      }

      return (await response.json()) as NvidiaChatCompletionResponse;
    },
  };
}

function providerError(error: unknown): TranslationAdapterError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new TranslationAdapterError("timeout", "NVIDIA translation timed out.");
  }

  const status =
    error && typeof error === "object" && "status" in error
      ? Reflect.get(error, "status")
      : undefined;
  const retryable =
    typeof status === "number" ? [408, 409, 429, 500, 502, 503, 504].includes(status) : true;

  return new TranslationAdapterError(
    "provider-unavailable",
    "NVIDIA translation is unavailable.",
    retryable,
  );
}

function languageTag(sourceLanguage: string, targetLanguage: string) {
  return `${sourceLanguage}-${targetLanguage}`.toLowerCase();
}

export class NvidiaTranslationAdapter implements TranslationAdapter {
  constructor(
    private readonly client: NvidiaTranslationClient,
    private readonly model: string,
    private readonly maxTokens: number,
  ) {}

  async translate(request: TranslationRequest, signal: AbortSignal) {
    if (!request.consent.nvidia) {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "NVIDIA processing has not been accepted.",
        false,
      );
    }
    if (!supportsNvidiaTranslationPair(request.sourceLanguage, request.targetLanguage)) {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "NVIDIA does not support this language direction.",
        false,
      );
    }

    let response: NvidiaChatCompletionResponse;
    try {
      response = await this.client.createChatCompletion(
        {
          max_tokens: this.maxTokens,
          messages: [
            {
              content: languageTag(request.sourceLanguage, request.targetLanguage),
              role: "system",
            },
            { content: request.text, role: "user" },
          ],
          model: this.model,
          temperature: 0,
          top_p: 1,
        },
        signal,
      );
    } catch (error) {
      throw providerError(error);
    }

    const translatedText = response.choices?.[0]?.message?.content?.trim();
    if (!translatedText) {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "NVIDIA returned an empty translation.",
        true,
      );
    }

    return translationResultSchema.parse({
      detectedSourceLanguage: request.sourceLanguage,
      provider: "nvidia",
      requestId: request.requestId,
      targetLanguage: request.targetLanguage,
      translatedText,
      warnings: [],
    });
  }
}
