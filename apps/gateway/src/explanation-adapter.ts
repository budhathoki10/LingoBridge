import type { ExplanationRequest, ExplanationResult } from "@lingobridge/contracts";

/** Explains a phrase the reader already translated. Failures use `TranslationAdapterError`. */
export interface ExplanationAdapter {
  explain(request: ExplanationRequest, signal: AbortSignal): Promise<ExplanationResult>;
}
