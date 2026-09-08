import { describe, expect, it } from "vitest";
import {
  anonymousInstallationIdSchema,
  capabilityCatalogueSchema,
  MAX_TRANSLATION_CODE_POINTS,
  MAX_TRANSLATION_RESPONSE_UTF8_BYTES,
  onlineConsentSchema,
  providerSchema,
  translationErrorSchema,
  translationRequestSchema,
  translationResultSchema,
} from "../../packages/contracts/src/index";

const validRequest = {
  consent: {
    acceptedAt: "2026-09-06T12:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
    version: "2026-09-06",
  },
  operation: "translate" as const,
  requestId: "1c3d9642-58bd-4ad8-a472-17a25faac1f4",
  sourceLanguage: "auto" as const,
  targetLanguage: "ne",
  text: "Where is the bus stop?",
};

describe("translationRequestSchema", () => {
  it("accepts a bounded request with explicit online consent", () => {
    expect(translationRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("rejects unknown request fields", () => {
    expect(
      translationRequestSchema.safeParse({ ...validRequest, unreviewedContext: "whole page" })
        .success,
    ).toBe(false);
  });

  it("rejects oversized source text", () => {
    expect(
      translationRequestSchema.safeParse({
        ...validRequest,
        text: "a".repeat(MAX_TRANSLATION_CODE_POINTS + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects a same-language request", () => {
    expect(
      translationRequestSchema.safeParse({
        ...validRequest,
        sourceLanguage: "ne",
      }).success,
    ).toBe(false);
  });
});

describe("providerSchema", () => {
  it("accepts only reviewed provider labels", () => {
    expect(providerSchema.safeParse("google").success).toBe(true);
    expect(providerSchema.safeParse("nvidia").success).toBe(true);
    expect(providerSchema.safeParse("unapproved-provider").success).toBe(false);
  });
});

describe("response and consent contracts", () => {
  it("accepts only UUID anonymous installation identifiers", () => {
    expect(anonymousInstallationIdSchema.safeParse(validRequest.requestId).success).toBe(true);
    expect(anonymousInstallationIdSchema.safeParse("device-1").success).toBe(false);
  });

  it("rejects unreviewed consent fields", () => {
    expect(
      onlineConsentSchema.safeParse({
        ...validRequest.consent,
        collectBrowsingHistory: true,
      }).success,
    ).toBe(false);
  });

  it("accepts a labelled translation result", () => {
    expect(
      translationResultSchema.safeParse({
        detectedSourceLanguage: "en",
        provider: "google",
        requestId: validRequest.requestId,
        targetLanguage: "ne",
        translatedText: "बस स्टप कहाँ छ?",
        warnings: [],
      }).success,
    ).toBe(true);
  });

  it("rejects provider output above the UTF-8 response ceiling", () => {
    expect(
      translationResultSchema.safeParse({
        detectedSourceLanguage: "en",
        provider: "google",
        requestId: validRequest.requestId,
        targetLanguage: "ne",
        translatedText: "न".repeat(MAX_TRANSLATION_RESPONSE_UTF8_BYTES),
        warnings: [],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown error codes and fields", () => {
    expect(
      translationErrorSchema.safeParse({
        code: "provider-secret-leaked",
        message: "Unsafe error",
        requestId: validRequest.requestId,
        retryable: false,
        stack: "must not cross the API boundary",
      }).success,
    ).toBe(false);
  });
});

describe("capabilityCatalogueSchema", () => {
  it("rejects unknown catalogue fields", () => {
    const result = capabilityCatalogueSchema.safeParse({
      catalogueVersion: "fixture-1",
      directions: [],
      generatedAt: "2026-09-06T12:00:00.000Z",
      languages: [],
      providerSecret: "must-not-exist",
    });

    expect(result.success).toBe(false);
  });
});
