import type { TranslationRequest, TranslationResult } from "@lingobridge/contracts";
import type { MetricProvider } from "@lingobridge/contracts/operations";
import { supportsNvidiaTranslationPair } from "./nvidia-capabilities.js";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

export interface TranslationStep {
  adapter: TranslationAdapter;
  /** Whether the reader's consent and the language direction let this step translate. */
  accepts(request: TranslationRequest): boolean;
  /** Readable name for the log, such as "NVIDIA Nemotron Ultra". */
  label: string;
  /** Named in fallback metrics when this step answers after an earlier one failed. */
  metricProvider: MetricProvider;
  /**
   * Longest this step may take before the next one is asked. Without it the step may use
   * whatever remains of the route's overall deadline.
   */
  timeoutMilliseconds?: number;
}

/** What a step did, for the operator log. Never carries the text being translated. */
export interface TranslationStepEvent {
  durationMilliseconds?: number;
  label: string;
  outcome: "answered" | "calling" | "failed" | "skipped";
  /** Source and target, such as "en-ne". */
  pair: string;
  /** The adapter's own content-free failure reason, or why a resting step was skipped. */
  reason?: string;
  /** For `failed`: how long the step now rests. For `skipped`: how long it still rests. */
  restSeconds?: number;
  /** Position in the order, counting from 1. */
  step: number;
}

export interface TranslationChainOptions {
  now?: () => number;
  /** Told whenever a later step is asked because an earlier one failed. */
  onFallback?: (provider: MetricProvider, succeeded: boolean) => void;
  /** Told when each step is called, skipped, or ends. */
  onStep?: (event: TranslationStepEvent) => void;
}

/** Outages in a row before a step rests; one success clears the count. */
const OUTAGES_BEFORE_REST = 3;
const OUTAGE_REST_MILLISECONDS = 2 * 60 * 1_000;
/** Rest for a `limited` failure that named no wait. */
const DEFAULT_LIMITED_REST_MILLISECONDS = 60 * 1_000;

interface StepHealth {
  consecutiveOutages: number;
  reason: string;
  /** Epoch milliseconds before which the step is skipped; 0 when it is not resting. */
  restUntil: number;
}

function failureReason(error: unknown): string {
  if (error instanceof TranslationAdapterError) return `${error.code}: ${error.message}`;
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  return "unexpected error";
}

/**
 * Asks each accepted step in order and returns the first usable translation. A step that fails,
 * refuses, or runs past its own time limit hands over to the next; only the reader cancelling
 * stops the chain early. Every step still runs inside the route's overall deadline.
 */
export class TranslationProviderChain implements TranslationAdapter {
  /**
   * Which steps are resting after a quota, rate limit, or repeated outage. Kept in memory like the
   * rate limiter: the gateway is single-instance, and a restart only means asking once more.
   */
  private readonly health = new Map<number, StepHealth>();
  private readonly now: () => number;

  constructor(
    private readonly steps: readonly TranslationStep[],
    private readonly options: TranslationChainOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    let lastError: unknown = null;
    let attempted = false;
    let skippedForRest = false;
    const pair = `${request.sourceLanguage}-${request.targetLanguage}`;
    for (const [index, step] of this.steps.entries()) {
      if (!step.accepts(request)) continue;
      if (signal.aborted) throw lastError ?? abortError();
      const event = { label: step.label, pair, step: index + 1 };
      const health = this.health.get(index);
      if (health && this.now() < health.restUntil) {
        skippedForRest = true;
        this.options.onStep?.({
          ...event,
          outcome: "skipped",
          reason: health.reason,
          restSeconds: Math.ceil((health.restUntil - this.now()) / 1_000),
        });
        continue;
      }
      const isFallback = attempted;
      attempted = true;
      const startedAt = this.now();
      this.options.onStep?.({ ...event, outcome: "calling" });
      try {
        const result = await this.run(step, request, signal);
        this.health.delete(index);
        this.options.onStep?.({
          ...event,
          durationMilliseconds: this.now() - startedAt,
          outcome: "answered",
        });
        if (isFallback) this.options.onFallback?.(step.metricProvider, true);
        return result;
      } catch (error) {
        const restMilliseconds = signal.aborted ? 0 : this.recordFailure(index, error);
        this.options.onStep?.({
          ...event,
          durationMilliseconds: this.now() - startedAt,
          outcome: "failed",
          reason: failureReason(error),
          ...(restMilliseconds > 0 ? { restSeconds: Math.ceil(restMilliseconds / 1_000) } : {}),
        });
        if (isFallback) this.options.onFallback?.(step.metricProvider, false);
        if (signal.aborted) throw error;
        lastError = error;
      }
    }

    if (!attempted && skippedForRest) {
      throw new TranslationAdapterError(
        "provider-unavailable",
        "Every translator is resting after hitting its limit. Try again shortly.",
        true,
      );
    }
    throw (
      lastError ??
      new TranslationAdapterError(
        "provider-unavailable",
        "No accepted provider can translate this language direction.",
        false,
      )
    );
  }

  /**
   * Rests a step that said it is limiting this caller, or that has failed for everyone several
   * times in a row. A failure specific to one request never rests the step. Returns the rest.
   */
  private recordFailure(index: number, error: unknown): number {
    if (!(error instanceof TranslationAdapterError) || error.kind === "request") return 0;
    if (error.kind === "limited") {
      const rest =
        error.retryAfterSeconds === null
          ? DEFAULT_LIMITED_REST_MILLISECONDS
          : error.retryAfterSeconds * 1_000;
      this.health.set(index, {
        consecutiveOutages: 0,
        reason: error.message,
        restUntil: this.now() + rest,
      });
      return rest;
    }
    const outages = (this.health.get(index)?.consecutiveOutages ?? 0) + 1;
    const resting = outages >= OUTAGES_BEFORE_REST;
    this.health.set(index, {
      consecutiveOutages: outages,
      reason: `${outages} failures in a row, last: ${error.message}`,
      restUntil: resting ? this.now() + OUTAGE_REST_MILLISECONDS : 0,
    });
    return resting ? OUTAGE_REST_MILLISECONDS : 0;
  }

  private async run(
    step: TranslationStep,
    request: TranslationRequest,
    signal: AbortSignal,
  ): Promise<TranslationResult> {
    if (step.timeoutMilliseconds === undefined) return step.adapter.translate(request, signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, step.timeoutMilliseconds);
    try {
      return await step.adapter.translate(request, controller.signal);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}

function abortError(): DOMException {
  return new DOMException("The translation was cancelled.", "AbortError");
}

export interface TranslationChainAdapters {
  /** MyMemory through the RapidAPI subscription; null when no subscription is configured. */
  myMemoryRapidApi: TranslationAdapter | null;
  /** MyMemory's free public endpoint, metered per IP address. */
  myMemoryPublic: TranslationAdapter;
  /** Nemotron, asked first for every direction when NVIDIA processing is accepted. */
  nemotron: TranslationAdapter;
  /** How long Nemotron may take before free MyMemory is asked instead. */
  nemotronTimeoutMilliseconds: number;
  onFallback?: TranslationChainOptions["onFallback"];
  onStep?: TranslationChainOptions["onStep"];
  /** Clock for resting periods; tests pass their own. */
  now?: TranslationChainOptions["now"];
  /** Riva, last, only for the directions its capability table supports. */
  riva: TranslationAdapter;
}

const acceptsMyMemory = (request: TranslationRequest) =>
  request.consent.myMemory === true && request.sourceLanguage !== "auto";

/**
 * The live translation order: Nemotron, free MyMemory, MyMemory through RapidAPI, then Riva.
 * Nemotron gives the best Nepali; the free endpoint spares the RapidAPI monthly allowance; Riva
 * covers its supported directions when both MyMemory endpoints are exhausted.
 */
export function createTranslationChain(adapters: TranslationChainAdapters): TranslationAdapter {
  return new TranslationProviderChain(
    [
      {
        accepts: (request) => request.consent.nvidia,
        adapter: adapters.nemotron,
        label: "NVIDIA Nemotron Ultra",
        metricProvider: "nvidia",
        timeoutMilliseconds: adapters.nemotronTimeoutMilliseconds,
      },
      {
        accepts: acceptsMyMemory,
        adapter: adapters.myMemoryPublic,
        label: "MyMemory free",
        metricProvider: "mymemory",
      },
      ...(adapters.myMemoryRapidApi
        ? [
            {
              accepts: acceptsMyMemory,
              adapter: adapters.myMemoryRapidApi,
              label: "MyMemory RapidAPI",
              metricProvider: "mymemory" as const,
            },
          ]
        : []),
      {
        accepts: (request) =>
          request.consent.nvidia &&
          request.consent.nvidiaBackup === true &&
          supportsNvidiaTranslationPair(request.sourceLanguage, request.targetLanguage),
        adapter: adapters.riva,
        label: "NVIDIA Riva",
        metricProvider: "nvidia",
      },
    ],
    { now: adapters.now, onFallback: adapters.onFallback, onStep: adapters.onStep },
  );
}
