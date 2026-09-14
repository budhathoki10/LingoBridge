import type { TranslationRequest, TranslationResult } from "@lingobridge/contracts";
import {
  type LanguagePairOperations,
  type MetricProvider,
  type OperationOutcome,
  type OperationsMetrics,
  type OperationsWarning,
  operationOutcomeSchema,
  operationsMetricsSchema,
} from "@lingobridge/contracts/operations";
import { ProviderInterruptedError } from "./provider-deadline.js";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

/**
 * Content-free operational aggregates for the admin view. The recorder accepts only enumerated
 * categories, language codes, durations, and counts; its API has no parameter that could carry
 * selected text, translations, installation ids, or network addresses. Aggregates live in memory
 * per gateway instance and roll over every 24 hours.
 */

export interface OperationsThresholds {
  /** Monthly or daily character allowance per provider; warnings start at 80%. */
  characterQuota: number | null;
  /** Estimated spend that triggers a warning, in US dollars. */
  costWarningUsd: number | null;
  /** Published price per million characters, used only for the estimate. */
  googlePricePerMillionCharactersUsd: number;
  nvidiaPricePerMillionCharactersUsd: number;
}

export const DEFAULT_OPERATIONS_THRESHOLDS: OperationsThresholds = {
  characterQuota: null,
  costWarningUsd: null,
  googlePricePerMillionCharactersUsd: 20,
  nvidiaPricePerMillionCharactersUsd: 0,
};

const WINDOW_MILLISECONDS = 24 * 60 * 60 * 1_000;
const MAX_LATENCY_SAMPLES = 1_000;
const MAX_LANGUAGE_PAIRS = 200;
const RECENT_ATTEMPTS = 5;

interface ProviderBucket {
  billableCharacters: number;
  fallbackAttempts: number;
  fallbackSuccesses: number;
  latencies: number[];
  outcomes: Record<OperationOutcome, number>;
  recent: boolean[];
  requests: number;
}

function emptyOutcomes(): Record<OperationOutcome, number> {
  return Object.fromEntries(
    operationOutcomeSchema.options.map((outcome) => [outcome, 0]),
  ) as Record<OperationOutcome, number>;
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index] ?? 0);
}

const LANGUAGE_CODE = /^(?:auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/u;

export class OperationalMetrics {
  readonly #now: () => number;
  #windowStartedAt: number;
  #providers = new Map<MetricProvider, ProviderBucket>();
  #pairs = new Map<string, LanguagePairOperations>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#windowStartedAt = now();
  }

  #rollIfNeeded(): void {
    if (this.#now() - this.#windowStartedAt < WINDOW_MILLISECONDS) return;
    this.#windowStartedAt = this.#now();
    this.#providers = new Map();
    this.#pairs = new Map();
  }

  #bucket(provider: MetricProvider): ProviderBucket {
    let bucket = this.#providers.get(provider);
    if (!bucket) {
      bucket = {
        billableCharacters: 0,
        fallbackAttempts: 0,
        fallbackSuccesses: 0,
        latencies: [],
        outcomes: emptyOutcomes(),
        recent: [],
        requests: 0,
      };
      this.#providers.set(provider, bucket);
    }
    return bucket;
  }

  recordAttempt(input: {
    characters: number;
    latencyMilliseconds: number | null;
    outcome: OperationOutcome;
    provider: MetricProvider;
    sourceLanguage: string;
    targetLanguage: string;
  }): void {
    this.#rollIfNeeded();
    const bucket = this.#bucket(input.provider);
    bucket.requests += 1;
    bucket.outcomes[input.outcome] += 1;
    if (input.outcome === "success") {
      bucket.billableCharacters += Math.max(0, Math.floor(input.characters));
    }
    if (input.latencyMilliseconds !== null && input.provider !== "none") {
      bucket.latencies.push(Math.max(0, input.latencyMilliseconds));
      if (bucket.latencies.length > MAX_LATENCY_SAMPLES) bucket.latencies.shift();
    }
    if (input.provider !== "none" && input.outcome !== "cancelled") {
      bucket.recent.push(input.outcome === "success");
      if (bucket.recent.length > RECENT_ATTEMPTS) bucket.recent.shift();
    }

    const source = LANGUAGE_CODE.test(input.sourceLanguage) ? input.sourceLanguage : "auto";
    if (!LANGUAGE_CODE.test(input.targetLanguage) || input.targetLanguage === "auto") return;
    const key = `${input.provider}|${source}|${input.targetLanguage}`;
    const pair = this.#pairs.get(key);
    if (pair) {
      pair.requests += 1;
    } else if (this.#pairs.size < MAX_LANGUAGE_PAIRS) {
      this.#pairs.set(key, {
        provider: input.provider,
        requests: 1,
        sourceLanguage: source,
        targetLanguage: input.targetLanguage,
      });
    }
  }

  recordFallback(succeeded: boolean): void {
    this.#rollIfNeeded();
    const bucket = this.#bucket("google");
    bucket.fallbackAttempts += 1;
    if (succeeded) bucket.fallbackSuccesses += 1;
  }

  snapshot(
    translationMode: "fake" | "live",
    thresholds: OperationsThresholds = DEFAULT_OPERATIONS_THRESHOLDS,
  ): OperationsMetrics {
    this.#rollIfNeeded();
    const warnings: OperationsWarning[] = [];
    const providers = [...this.#providers.entries()].map(([provider, bucket]) => {
      const sorted = [...bucket.latencies].sort((left, right) => left - right);
      const failures = bucket.requests - bucket.outcomes.success - bucket.outcomes.cancelled;

      if (provider !== "none") {
        if (bucket.requests >= 20 && failures / bucket.requests > 0.2) {
          warnings.push({
            code: "error-rate-high",
            message: `More than 20% of ${provider} attempts failed in this window.`,
            provider,
          });
        }
        if (bucket.recent.length === RECENT_ATTEMPTS && bucket.recent.every((ok) => !ok)) {
          warnings.push({
            code: "provider-down",
            message: `The last ${RECENT_ATTEMPTS} ${provider} attempts failed.`,
            provider,
          });
        }
        if (
          thresholds.characterQuota !== null &&
          bucket.billableCharacters >= thresholds.characterQuota * 0.8
        ) {
          warnings.push({
            code: "quota-near-limit",
            message: `${provider} usage reached 80% of the configured character quota.`,
            provider,
          });
        }
        const price =
          provider === "google"
            ? thresholds.googlePricePerMillionCharactersUsd
            : provider === "nvidia"
              ? thresholds.nvidiaPricePerMillionCharactersUsd
              : 0;
        const estimated = (bucket.billableCharacters / 1_000_000) * price;
        if (thresholds.costWarningUsd !== null && estimated >= thresholds.costWarningUsd) {
          warnings.push({
            code: "estimated-cost-high",
            message: `Estimated ${provider} spend reached the configured warning level.`,
            provider,
          });
        }
      }

      return {
        billableCharacters: bucket.billableCharacters,
        fallbackAttempts: bucket.fallbackAttempts,
        fallbackSuccesses: bucket.fallbackSuccesses,
        latencyMedianMs: percentile(sorted, 0.5),
        latencyP95Ms: percentile(sorted, 0.95),
        outcomes: { ...bucket.outcomes },
        provider,
        requests: bucket.requests,
      };
    });

    return operationsMetricsSchema.parse({
      generatedAt: new Date(this.#now()).toISOString(),
      languagePairs: [...this.#pairs.values()]
        .sort((left, right) => right.requests - left.requests)
        .map((pair) => ({ ...pair })),
      providers,
      translationMode,
      warnings: warnings.slice(0, 20),
      windowStartedAt: new Date(this.#windowStartedAt).toISOString(),
    });
  }
}

export function outcomeForError(error: unknown): OperationOutcome {
  if (error instanceof ProviderInterruptedError) {
    return error.reason === "timeout" ? "timeout" : "cancelled";
  }
  if (error instanceof TranslationAdapterError) {
    return error.code === "timeout" ? "timeout" : "provider-error";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  return "provider-error";
}

/** Times one provider and records its attempt. Only the character count of the text is read. */
export function observeTranslationAdapter(
  adapter: TranslationAdapter,
  provider: MetricProvider,
  metrics: OperationalMetrics,
  now: () => number = () => performance.now(),
): TranslationAdapter {
  return {
    async translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
      const startedAt = now();
      const base = {
        characters: Array.from(request.text).length,
        provider,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
      };
      try {
        const result = await adapter.translate(request, signal);
        metrics.recordAttempt({
          ...base,
          latencyMilliseconds: now() - startedAt,
          outcome: "success",
        });
        return result;
      } catch (error) {
        metrics.recordAttempt({
          ...base,
          latencyMilliseconds: now() - startedAt,
          outcome: outcomeForError(error),
        });
        throw error;
      }
    },
  };
}
