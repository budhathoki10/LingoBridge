import { z } from "zod";

export const MAX_TRANSLATION_CODE_POINTS = 5_000;
export const MAX_TRANSLATION_UTF8_BYTES = 20 * 1_024;
export const GATEWAY_API_VERSION = "v1" as const;
export const GATEWAY_ROUTES = {
  capabilities: "/v1/capabilities",
  health: "/v1/health",
  translate: "/v1/translate",
  version: "/v1/version",
} as const;

const utf8Encoder = new TextEncoder();

export const languageCodeSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Expected a BCP 47 language code");

export const requestIdSchema = z.string().uuid();

export const translationTextSchema = z.string().superRefine((text, context) => {
  if (text.trim().length === 0) {
    context.addIssue({ code: "custom", message: "Translation text cannot be empty" });
  }

  if (Array.from(text).length > MAX_TRANSLATION_CODE_POINTS) {
    context.addIssue({
      code: "custom",
      message: `Translation text cannot exceed ${MAX_TRANSLATION_CODE_POINTS} code points`,
    });
  }

  if (utf8Encoder.encode(text).byteLength > MAX_TRANSLATION_UTF8_BYTES) {
    context.addIssue({
      code: "custom",
      message: `Translation text cannot exceed ${MAX_TRANSLATION_UTF8_BYTES} UTF-8 bytes`,
    });
  }
});

export const providerSchema = z.enum(["on-device", "google", "nvidia"]);

export const onlineConsentSchema = z
  .object({
    acceptedAt: z.string().datetime({ offset: true }),
    google: z.literal(true),
    nvidiaBackup: z.boolean(),
    version: z.string().min(1).max(40),
  })
  .strict();

export const translationRequestSchema = z
  .object({
    consent: onlineConsentSchema,
    operation: z.literal("translate"),
    requestId: requestIdSchema,
    sourceLanguage: z.union([languageCodeSchema, z.literal("auto")]),
    targetLanguage: languageCodeSchema,
    text: translationTextSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.sourceLanguage !== "auto" &&
      request.sourceLanguage.toLowerCase() === request.targetLanguage.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "Source and target languages must be different",
        path: ["targetLanguage"],
      });
    }
  });

export const translationWarningSchema = z
  .object({
    code: z.enum(["low-confidence", "formatting-changed", "capability-stale"]),
    message: z.string().min(1).max(240),
  })
  .strict();

export const translationResultSchema = z
  .object({
    detectedSourceLanguage: languageCodeSchema.nullable(),
    provider: providerSchema,
    requestId: requestIdSchema,
    targetLanguage: languageCodeSchema,
    translatedText: z.string().min(1).max(MAX_TRANSLATION_UTF8_BYTES),
    warnings: z.array(translationWarningSchema).max(10),
  })
  .strict();

export const translationErrorSchema = z
  .object({
    code: z.enum([
      "invalid-request",
      "unsupported-pair",
      "rate-limited",
      "provider-unavailable",
      "timeout",
      "cancelled",
      "internal-error",
    ]),
    message: z.string().min(1).max(240),
    requestId: requestIdSchema.nullable(),
    retryable: z.boolean(),
  })
  .strict();

export const languageCapabilitySchema = z
  .object({
    code: languageCodeSchema,
    name: z.string().min(1).max(100),
    nativeName: z.string().min(1).max(100).nullable(),
    textDirection: z.enum(["ltr", "rtl"]),
  })
  .strict();

export const directionCapabilitySchema = z
  .object({
    google: z.boolean(),
    nvidiaBackup: z.boolean(),
    sourceLanguage: languageCodeSchema,
    targetLanguage: languageCodeSchema,
  })
  .strict();

export const capabilityCatalogueSchema = z
  .object({
    catalogueVersion: z.string().min(1).max(80),
    directions: z.array(directionCapabilitySchema),
    generatedAt: z.string().datetime({ offset: true }),
    languages: z.array(languageCapabilitySchema),
  })
  .strict();

export const gatewayHealthSchema = z
  .object({
    service: z.literal("lingobridge-gateway"),
    status: z.literal("ok"),
  })
  .strict();

export const gatewayVersionSchema = z
  .object({
    apiVersion: z.literal(GATEWAY_API_VERSION),
    serviceVersion: z.string().min(1).max(40),
    translationMode: z.enum(["fake", "live"]),
  })
  .strict();

export type CapabilityCatalogue = z.infer<typeof capabilityCatalogueSchema>;
export type GatewayHealth = z.infer<typeof gatewayHealthSchema>;
export type GatewayVersion = z.infer<typeof gatewayVersionSchema>;
export type LanguageCapability = z.infer<typeof languageCapabilitySchema>;
export type OnlineConsent = z.infer<typeof onlineConsentSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type TranslationError = z.infer<typeof translationErrorSchema>;
export type TranslationRequest = z.infer<typeof translationRequestSchema>;
export type TranslationResult = z.infer<typeof translationResultSchema>;
