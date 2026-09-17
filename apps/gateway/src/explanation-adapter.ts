import type {
  ExplanationRequest,
  ExplanationResult,
  TransliterationRequest,
  TransliterationResult,
  WordUnderstandingRequest,
  WordUnderstandingResult,
} from "@lingobridge/contracts";

/** Explains a phrase the reader already translated. Failures use `TranslationAdapterError`. */
export interface ExplanationAdapter {
  explain(request: ExplanationRequest, signal: AbortSignal): Promise<ExplanationResult>;
  transliterate(
    request: TransliterationRequest,
    signal: AbortSignal,
  ): Promise<TransliterationResult>;
  understandWord(
    request: WordUnderstandingRequest,
    signal: AbortSignal,
  ): Promise<WordUnderstandingResult>;
}
