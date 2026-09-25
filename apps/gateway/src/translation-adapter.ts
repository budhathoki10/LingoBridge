import type { TranslationRequest, TranslationResult } from "@lingobridge/contracts";

export interface TranslationAdapter {
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
}

/**
 * Why a provider call failed, as far as the translation chain cares:
 * - `limited`: the provider refused this caller for a while (quota exhausted, rate-limited), so the
 *   chain rests it and skips it until it should accept again.
 * - `outage`: the provider is down, slow, or erroring; repeated outages also rest it.
 * - `request`: only this request failed (an unusable answer, an unsupported direction, missing
 *   consent), so the provider stays in rotation.
 */
export type ProviderFailureKind = "limited" | "outage" | "request";

export interface TranslationAdapterErrorDetails {
  kind?: ProviderFailureKind;
  /** For `limited`: how long the provider asked the caller to wait. */
  retryAfterSeconds?: number | null;
}

export class TranslationAdapterError extends Error {
  readonly code: "provider-unavailable" | "timeout";
  readonly kind: ProviderFailureKind;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: "provider-unavailable" | "timeout",
    message: string,
    retryable = true,
    details: TranslationAdapterErrorDetails = {},
  ) {
    super(message);
    this.name = "TranslationAdapterError";
    this.code = code;
    this.retryable = retryable;
    this.kind = details.kind ?? (code === "timeout" ? "outage" : "request");
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
  }
}

/** Reads a Retry-After header given in seconds; anything else counts as absent. */
export function retryAfterSecondsFrom(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Classifies an HTTP failure. 429 means the provider is limiting this caller; a bad request is
 * specific to the request; everything else (5xx, auth, network) is treated as an outage.
 */
export function failureKindForStatus(status: number | null): ProviderFailureKind {
  if (status === 429) return "limited";
  if (status === 400 || status === 404 || status === 422) return "request";
  return "outage";
}
