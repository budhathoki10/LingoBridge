import { type TranslationRequest, translationResultSchema } from "@lingobridge/contracts";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

const MAX_SEGMENT_BYTES = 500;
const utf8Encoder = new TextEncoder();

export interface MyMemoryResponse {
  quotaFinished?: boolean | null;
  responseData?: { translatedText?: string | null } | null;
  responseDetails?: string | null;
  responseStatus?: number | string | null;
}

export interface MyMemoryClient {
  translate(
    request: { contactEmail: string; sourceLanguage: string; targetLanguage: string; text: string },
    signal: AbortSignal,
  ): Promise<MyMemoryResponse>;
}

export function createMyMemoryClient(baseUrl: string): MyMemoryClient {
  const endpoint = new URL("get", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  return {
    async translate(request, signal) {
      const url = new URL(endpoint);
      url.searchParams.set("q", request.text);
      url.searchParams.set("langpair", `${request.sourceLanguage}|${request.targetLanguage}`);
      url.searchParams.set("de", request.contactEmail);
      url.searchParams.set("mt", "1");

      const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
      if (!response.ok) {
        throw Object.assign(new Error("MyMemory translation request failed."), {
          status: response.status,
        });
      }
      return (await response.json()) as MyMemoryResponse;
    },
  };
}

function providerError(error: unknown): TranslationAdapterError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new TranslationAdapterError("timeout", "MyMemory translation timed out.");
  }
  const status =
    error && typeof error === "object" && "status" in error
      ? Reflect.get(error, "status")
      : undefined;
  const retryable =
    typeof status === "number" ? [408, 409, 429, 500, 502, 503, 504].includes(status) : true;
  return new TranslationAdapterError(
    "provider-unavailable",
    "MyMemory translation is unavailable.",
    retryable,
  );
}

function isBreakCharacter(character: string): boolean {
  return /\s|[.!?;:。！？；：]/u.test(character);
}

/** Splits provider requests without breaking UTF-8 code points or paragraph separators. */
export function splitMyMemorySegments(text: string): Array<{ separator: string; text: string }> {
  const output: Array<{ separator: string; text: string }> = [];
  const appendSeparator = (separator: string) => {
    const previous = output.at(-1);
    if (previous) previous.separator += separator;
  };
  for (const block of text.split(/(\r\n|\r|\n)/u)) {
    if (!block) continue;
    if (/^(?:\r\n|\r|\n)$/u.test(block)) {
      appendSeparator(block);
      continue;
    }

    let remaining = block;
    while (remaining) {
      if (utf8Encoder.encode(remaining).byteLength <= MAX_SEGMENT_BYTES) {
        const leading = remaining.match(/^\s+/u)?.[0] ?? "";
        const trailing = remaining.match(/\s+$/u)?.[0] ?? "";
        const content = remaining.slice(leading.length, remaining.length - trailing.length);
        if (content) output.push({ separator: trailing, text: `${leading}${content}` });
        else appendSeparator(remaining);
        break;
      }

      let bytes = 0;
      let codeUnitIndex = 0;
      let preferredBreak = 0;
      for (const character of remaining) {
        const nextBytes = utf8Encoder.encode(character).byteLength;
        if (bytes + nextBytes > MAX_SEGMENT_BYTES) break;
        bytes += nextBytes;
        codeUnitIndex += character.length;
        if (isBreakCharacter(character)) preferredBreak = codeUnitIndex;
      }
      const splitAt = preferredBreak > 0 ? preferredBreak : codeUnitIndex;
      const part = remaining.slice(0, splitAt);
      remaining = remaining.slice(splitAt);
      const leading = part.match(/^\s+/u)?.[0] ?? "";
      const trailing = part.match(/\s+$/u)?.[0] ?? "";
      const content = part.slice(leading.length, part.length - trailing.length);
      if (content) output.push({ separator: trailing, text: `${leading}${content}` });
      else appendSeparator(part);
    }
  }
  return output;
}

function successfulTranslation(response: MyMemoryResponse): string | null {
  const status = Number(response.responseStatus);
  if (response.quotaFinished || status !== 200) return null;
  const translatedText = response.responseData?.translatedText?.trim();
  return translatedText || null;
}

export class MyMemoryTranslationAdapter implements TranslationAdapter {
  constructor(
    private readonly client: MyMemoryClient,
    private readonly contactEmail: string,
  ) {}

  async translate(request: TranslationRequest, signal: AbortSignal) {
    if (!request.consent.myMemory) {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "MyMemory processing has not been accepted.",
        false,
      );
    }
    if (request.sourceLanguage === "auto") {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "MyMemory requires a detected source language.",
        false,
      );
    }

    const translated: string[] = [];
    try {
      for (const segment of splitMyMemorySegments(request.text)) {
        const response = await this.client.translate(
          {
            contactEmail: this.contactEmail,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            text: segment.text,
          },
          signal,
        );
        const text = successfulTranslation(response);
        if (!text) {
          throw new TranslationAdapterError(
            "provider-unavailable",
            response.quotaFinished
              ? "MyMemory daily quota is exhausted."
              : "MyMemory returned an unusable translation.",
            true,
          );
        }
        translated.push(`${text}${segment.separator}`);
      }
    } catch (error) {
      if (error instanceof TranslationAdapterError) throw error;
      throw providerError(error);
    }

    const translatedText = translated.join("").trim();
    if (!translatedText) {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "MyMemory returned an empty translation.",
        true,
      );
    }

    return translationResultSchema.parse({
      detectedSourceLanguage: request.sourceLanguage,
      provider: "mymemory",
      requestId: request.requestId,
      targetLanguage: request.targetLanguage,
      translatedText,
      warnings: [],
    });
  }
}
