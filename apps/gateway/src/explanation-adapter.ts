import type {
  ExplanationRequest,
  ExplanationResult,
  WordUnderstandingRequest,
  WordUnderstandingResult,
} from "@lingobridge/contracts";

/** Explains a phrase the reader already translated. Failures use `TranslationAdapterError`. */
export interface ExplanationAdapter {
  explain(request: ExplanationRequest, signal: AbortSignal): Promise<ExplanationResult>;
  understandWord(
    request: WordUnderstandingRequest,
    signal: AbortSignal,
  ): Promise<WordUnderstandingResult>;
}
