import { z } from "zod";
import { languageCodeSchema } from "./index.js";

/**
 * Operational metrics are aggregates only: provider, language codes, outcome category, latency,
 * fallback flags, and counts. No field can hold selected text, translated text, saved phrases,
 * installation identifiers, network addresses, or credentials.
 */

export const OPERATIONS_METRICS_ROUTE = "/v1/internal/operations-metrics";

export const operationOutcomeSchema = z.enum([
  "success",
  "timeout",
  "rate-limited",
  "unsupported-pair",
  "provider-error",
  "cancelled",
  "invalid-request",
]);

export const metricProviderSchema = z.enum(["mymemory", "nvidia", "google", "fake", "none"]);

const countSchema = z.number().int().min(0);
const latencySchema = z.number().int().min(0).nullable();

export const providerOperationsSchema = z
  .object({
    billableCharacters: countSchema,
    fallbackAttempts: countSchema,
    fallbackSuccesses: countSchema,
    latencyMedianMs: latencySchema,
    latencyP95Ms: latencySchema,
    outcomes: z.record(operationOutcomeSchema, countSchema),
    provider: metricProviderSchema,
    requests: countSchema,
  })
  .strict();

export const languagePairOperationsSchema = z
  .object({
    provider: metricProviderSchema,
    requests: countSchema,
    sourceLanguage: z.union([languageCodeSchema, z.literal("auto")]),
    targetLanguage: languageCodeSchema,
  })
  .strict();

export const operationsWarningSchema = z
  .object({
    code: z.enum(["quota-near-limit", "estimated-cost-high", "error-rate-high", "provider-down"]),
    message: z.string().min(1).max(240),
    provider: metricProviderSchema,
  })
  .strict();

export const operationsMetricsSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    languagePairs: z.array(languagePairOperationsSchema).max(200),
    providers: z.array(providerOperationsSchema).max(8),
    translationMode: z.enum(["fake", "live"]),
    warnings: z.array(operationsWarningSchema).max(20),
    windowStartedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type LanguagePairOperations = z.infer<typeof languagePairOperationsSchema>;
export type MetricProvider = z.infer<typeof metricProviderSchema>;
export type OperationOutcome = z.infer<typeof operationOutcomeSchema>;
export type OperationsMetrics = z.infer<typeof operationsMetricsSchema>;
export type OperationsWarning = z.infer<typeof operationsWarningSchema>;
export type ProviderOperations = z.infer<typeof providerOperationsSchema>;
