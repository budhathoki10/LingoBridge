import type { TranslationRequest, TranslationResult } from "@lingobridge/contracts";

export interface TranslationAdapter {
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
}

export class TranslationAdapterError extends Error {
  readonly code: "provider-unavailable" | "timeout";
  readonly retryable: boolean;

  constructor(code: "provider-unavailable" | "timeout", message: string, retryable = true) {
    super(message);
    this.name = "TranslationAdapterError";
    this.code = code;
    this.retryable = retryable;
  }
}
