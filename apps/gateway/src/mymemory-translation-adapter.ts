import { type TranslationRequest, translationResultSchema } from "@lingobridge/contracts";
import {
  failureKindForStatus,
  type TranslationAdapter,
  TranslationAdapterError,
} from "./translation-adapter.js";

const MAX_SEGMENT_BYTES = 500;
/** Rest for a rate limit that names no wait of its own. */
const DEFAULT_RATE_LIMIT_SECONDS = 60;
/** Rest for an exhausted daily quota that names no reset time; it is tried again afterwards. */
const DEFAULT_QUOTA_REST_SECONDS = 60 * 60;
const utf8Encoder = new TextEncoder();

export interface MyMemoryResponse {
  quotaFinished?: boolean | null;
  responseData?: { translatedText?: string | null } | null;
  responseDetails?: string | null;
  responseStatus?: number | string | null;
  /** Seconds until this caller's quota window resets, from the `Retry-After` response header. */
  retryAfterSeconds?: number | null;
}

/**
 * Why a request failed, in provider terms. Content-free by construction: it carries MyMemory's
 * own status fields and never the text that was being translated.
 */
export interface MyMemoryFailure {
  detail: string | null;
  httpStatus: number | null;
  outcome: "empty" | "quota-exhausted" | "rejected" | "timeout" | "unreachable";
  quotaFinished: boolean | null;
  responseStatus: number | string | null;
  retryAfterSeconds: number | null;
}

export interface MyMemoryClientOptions {
  /**
   * MyMemory's own private Translation Memory key, sent as `key`. Their spec describes it as
   * granting "customized API limits", but whether it lifts the per-IP daily quota is not
   * documented and could not be measured without exhausting that quota deliberately. It is sent
   * when configured because it cannot hurt, not because it is known to help.
   */
  privateKey?: string | null;
  rapidApiHost?: string;
  /**
   * Present only when a RapidAPI subscription is configured. It redirects the same API to the
   * RapidAPI host, where the daily quota belongs to the subscribing account rather than to the
   * egress IP address the instance happens to share.
   */
  rapidApiKey?: string | null;
}

export interface MyMemoryClient {
  translate(
    request: { contactEmail: string; sourceLanguage: string; targetLanguage: string; text: string },
    signal: AbortSignal,
  ): Promise<MyMemoryResponse>;
}

function readRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function createMyMemoryClient(
  baseUrl: string,
  options: MyMemoryClientOptions = {},
): MyMemoryClient {
  const privateKey = options.privateKey?.trim() || null;
  const rapidApiKey = options.rapidApiKey?.trim() || null;
  const rapidApiHost = options.rapidApiHost?.trim() || null;
  // RapidAPI serves the same `/get` contract, so only the host and the auth headers change.
  const endpoint =
    rapidApiKey && rapidApiHost
      ? new URL("get", `https://${rapidApiHost}/`)
      : new URL("get", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers: Record<string, string> =
    rapidApiKey && rapidApiHost
      ? {
          Accept: "application/json",
          "X-RapidAPI-Host": rapidApiHost,
          "X-RapidAPI-Key": rapidApiKey,
        }
      : { Accept: "application/json" };

  return {
    async translate(request, signal) {
      const url = new URL(endpoint);
      url.searchParams.set("q", request.text);
      url.searchParams.set("langpair", `${request.sourceLanguage}|${request.targetLanguage}`);
      url.searchParams.set("de", request.contactEmail);
      url.searchParams.set("mt", "1");
      if (privateKey) url.searchParams.set("key", privateKey);

      const response = await fetch(url, { headers, signal });
      if (!response.ok) {
        throw Object.assign(new Error("MyMemory translation request failed."), {
          retryAfterSeconds: readRetryAfterSeconds(response),
          status: response.status,
        });
      }
      const body = (await response.json()) as MyMemoryResponse;
      return { ...body, retryAfterSeconds: readRetryAfterSeconds(response) };
    },
  };
}

function httpStatusOf(error: unknown): number | null {
  const status =
    error && typeof error === "object" && "status" in error
      ? Reflect.get(error, "status")
      : undefined;
  return typeof status === "number" ? status : null;
}

/** Keeps a provider status line short enough to log without turning entries into prose. */
function truncateDetail(detail: string | null | undefined): string | null {
  const text = detail?.trim();
  if (!text) return null;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function providerError(error: unknown): TranslationAdapterError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new TranslationAdapterError("timeout", "MyMemory translation timed out.");
  }
  const status = httpStatusOf(error);
  const retryable =
    typeof status === "number" ? [408, 409, 429, 500, 502, 503, 504].includes(status) : true;
  const kind = failureKindForStatus(status);
  const retryAfter =
    error && typeof error === "object" && "retryAfterSeconds" in error
      ? Reflect.get(error, "retryAfterSeconds")
      : null;
  return new TranslationAdapterError(
    "provider-unavailable",
    kind === "limited"
      ? "MyMemory is rate-limiting requests."
      : "MyMemory translation is unavailable.",
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
    /**
     * Told why a request failed, so an outage names itself in the logs instead of arriving as a
     * bare 503. Quota exhaustion and a rejected key are indistinguishable from the outside.
     */
    private readonly onFailure: (failure: MyMemoryFailure) => void = () => undefined,
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
          this.onFailure({
            detail: truncateDetail(response.responseDetails),
            httpStatus: 200,
            outcome: response.quotaFinished ? "quota-exhausted" : "rejected",
            quotaFinished: response.quotaFinished ?? null,
            responseStatus: response.responseStatus ?? null,
            retryAfterSeconds: response.retryAfterSeconds ?? null,
          });
          const rateLimited = Number(response.responseStatus) === 429;
          throw new TranslationAdapterError(
            "provider-unavailable",
            response.quotaFinished
              ? "MyMemory daily quota is exhausted."
              : rateLimited
                ? "MyMemory is rate-limiting requests."
                : "MyMemory returned an unusable translation.",
            true,
            response.quotaFinished
              ? {
                  kind: "limited",
                  retryAfterSeconds: response.retryAfterSeconds ?? DEFAULT_QUOTA_REST_SECONDS,
                }
              : rateLimited
                ? {
                    kind: "limited",
                    retryAfterSeconds: response.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_SECONDS,
                  }
                : {},
          );
        }
        translated.push(`${text}${segment.separator}`);
      }
    } catch (error) {
      if (error instanceof TranslationAdapterError) throw error;
      const failure = providerError(error);
      this.onFailure({
        detail: null,
        httpStatus: httpStatusOf(error),
        outcome: failure.code === "timeout" ? "timeout" : "unreachable",
        quotaFinished: null,
        responseStatus: null,
        retryAfterSeconds: null,
      });
      throw failure;
    }

    const translatedText = translated.join("").trim();
    if (!translatedText) {
      this.onFailure({
        detail: null,
        httpStatus: 200,
        outcome: "empty",
        quotaFinished: null,
        responseStatus: null,
        retryAfterSeconds: null,
      });
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
