import { type TranslationRequest, translationResultSchema } from "@lingobridge/contracts";
import { supportsNvidiaTranslationPair, toNvidiaLanguageCode } from "./nvidia-capabilities.js";
import {
  failureKindForStatus,
  retryAfterSecondsFrom,
  type TranslationAdapter,
  TranslationAdapterError,
} from "./translation-adapter.js";

export interface NvidiaChatCompletionRequest {
  chat_template_kwargs?: { enable_thinking: boolean };
  max_tokens: number;
  messages: Array<{ content: string; role: "assistant" | "system" | "user" }>;
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
          retryAfterSeconds: retryAfterSecondsFrom(response),
          status: response.status,
        });
      }

      return (await response.json()) as NvidiaChatCompletionResponse;
    },
  };
}

/** Rest for an NVIDIA rate limit that names no wait of its own. */
const DEFAULT_RATE_LIMIT_SECONDS = 60;

/**
 * Maps an NVIDIA client failure for any model: 429 becomes `limited` with NVIDIA's own wait,
 * other HTTP and network failures become `outage` or `request`. Shared by Riva and Nemotron.
 */
export function nvidiaProviderError(error: unknown, model: string): TranslationAdapterError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new TranslationAdapterError("timeout", `${model} translation timed out.`);
  }

  const rawStatus =
    error && typeof error === "object" && "status" in error
      ? Reflect.get(error, "status")
      : undefined;
  const status = typeof rawStatus === "number" ? rawStatus : null;
  const retryable = status === null || [408, 409, 429, 500, 502, 503, 504].includes(status);
  const kind = failureKindForStatus(status);
  const retryAfter =
    error && typeof error === "object" && "retryAfterSeconds" in error
      ? Reflect.get(error, "retryAfterSeconds")
      : null;

  return new TranslationAdapterError(
    "provider-unavailable",
    kind === "limited"
      ? `NVIDIA is rate-limiting ${model} requests.`
      : `${model} translation is unavailable.`,
    retryable,
    {
      kind,
      retryAfterSeconds:
        kind === "limited"
          ? typeof retryAfter === "number"
            ? retryAfter
            : DEFAULT_RATE_LIMIT_SECONDS
          : null,
    },
  );
}

function providerError(error: unknown): TranslationAdapterError {
  return nvidiaProviderError(error, "NVIDIA");
}

function languageTag(sourceLanguage: string, targetLanguage: string) {
  const source = toNvidiaLanguageCode(sourceLanguage);
  const target = toNvidiaLanguageCode(targetLanguage);
  if (!source || !target) return null;
  return `${source}-${target}`.toLowerCase();
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
    const promptLanguageTag = languageTag(request.sourceLanguage, request.targetLanguage);
    if (!promptLanguageTag) {
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
              content: promptLanguageTag,
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
