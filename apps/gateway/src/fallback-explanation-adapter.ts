import type { ExplanationRequest, WordUnderstandingRequest } from "@lingobridge/contracts";
import type { ExplanationAdapter } from "./explanation-adapter.js";

export interface FallbackExplanationOptions {
  fallback: ExplanationAdapter;
  primary: ExplanationAdapter;
  /** How long the primary may take before the fallback is asked instead. */
  primaryTimeoutMilliseconds: number;
}

/**
 * Asks the primary provider first and, when it fails or is too slow, the fallback once. The
 * fallback is used only when the reader's consent names it, so text never reaches a provider the
 * reader did not accept.
 */
export class FallbackExplanationAdapter implements ExplanationAdapter {
  constructor(private readonly options: FallbackExplanationOptions) {}

  explain(request: ExplanationRequest, signal: AbortSignal) {
    return this.run(
      request.consent.openRouter === true,
      (adapter, attemptSignal) => adapter.explain(request, attemptSignal),
      signal,
    );
  }

  understandWord(request: WordUnderstandingRequest, signal: AbortSignal) {
    return this.run(
      request.consent.openRouter === true,
      (adapter, attemptSignal) => adapter.understandWord(request, attemptSignal),
      signal,
    );
  }

  private async run<T>(
    fallbackAllowed: boolean,
    attempt: (adapter: ExplanationAdapter, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (!fallbackAllowed) return attempt(this.options.primary, signal);

    const primaryController = new AbortController();
    const abortPrimary = () => primaryController.abort();
    if (signal.aborted) abortPrimary();
    signal.addEventListener("abort", abortPrimary, { once: true });
    const timer = setTimeout(abortPrimary, this.options.primaryTimeoutMilliseconds);
    try {
      return await attempt(this.options.primary, primaryController.signal);
    } catch (error) {
      if (signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortPrimary);
    }
    return attempt(this.options.fallback, signal);
  }
}
