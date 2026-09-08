import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { fakeCapabilityCatalogue } from "../../apps/gateway/src/capabilities";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import {
  ANONYMOUS_INSTALLATION_HEADER,
  capabilityCatalogueSchema,
  GATEWAY_ROUTES,
  gatewayHealthSchema,
  gatewayVersionSchema,
  type TranslationRequest,
  translationErrorSchema,
  translationResultSchema,
} from "../../packages/contracts/src/index";

const validRequest: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
    version: "phase-3.1-fake-gateway",
  },
  operation: "translate",
  requestId: "916e3e8b-dc89-46d0-8c0a-e93478257511",
  sourceLanguage: "en",
  targetLanguage: "ne",
  text: "Hello, how are you?",
};

const installationHeaders = {
  "Content-Type": "application/json",
  [ANONYMOUS_INSTALLATION_HEADER]: "1fb7891e-277d-4cba-aaf9-f7d33703f67e",
};

function createTestApp() {
  return createGatewayApp({
    logger: { info: () => undefined },
    translationAdapter: new FakeTranslationAdapter(0),
  });
}

describe("gateway metadata routes", () => {
  it("returns contract-valid health and version responses", async () => {
    const app = createTestApp();
    const healthResponse = await app.request(GATEWAY_ROUTES.health);
    const versionResponse = await app.request(GATEWAY_ROUTES.version);

    expect(healthResponse.status).toBe(200);
    expect(gatewayHealthSchema.safeParse(await healthResponse.json()).success).toBe(true);
    expect(versionResponse.status).toBe(200);
    expect(gatewayVersionSchema.parse(await versionResponse.json()).translationMode).toBe("fake");
  });

  it("returns the versioned fake capability catalogue", async () => {
    const response = await createTestApp().request(GATEWAY_ROUTES.capabilities);
    const catalogue = capabilityCatalogueSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(catalogue.catalogueVersion).toContain("phase-3.1-fake");
    expect(catalogue.languages.some((language) => language.code === "ne")).toBe(true);
    expect(catalogue.directions).toContainEqual({
      google: true,
      nvidia: false,
      nvidiaBackup: false,
      sourceLanguage: "en",
      targetLanguage: "ne",
    });
  });

  it("returns a safe failure when no valid capability catalogue exists", async () => {
    const response = await createGatewayApp({
      capabilityProvider: {
        async get() {
          throw new Error("private provider detail");
        },
      },
      logger: { info: () => undefined },
    }).request(GATEWAY_ROUTES.capabilities);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(translationErrorSchema.parse(JSON.parse(body)).code).toBe("provider-unavailable");
    expect(body).not.toContain("private provider detail");
  });
});

describe("POST /v1/translate", () => {
  it("returns a deterministic contract-valid result from the fake adapter", async () => {
    const response = await createTestApp().request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify(validRequest),
      headers: installationHeaders,
      method: "POST",
    });
    const result = translationResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      detectedSourceLanguage: "en",
      provider: "google",
      requestId: validRequest.requestId,
      targetLanguage: "ne",
      translatedText: "नमस्ते, तपाईंलाई कस्तो छ?",
    });
  });

  it("rejects malformed requests without reflecting source text", async () => {
    const sourceText = "private source text must not appear in the error";
    const response = await createTestApp().request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify({ ...validRequest, text: sourceText, unexpected: true }),
      headers: installationHeaders,
      method: "POST",
    });
    const body = await response.text();
    const error = translationErrorSchema.parse(JSON.parse(body));

    expect(response.status).toBe(400);
    expect(error.code).toBe("invalid-request");
    expect(body).not.toContain(sourceText);
  });

  it("rejects a direction absent from the active catalogue before the adapter", async () => {
    const response = await createTestApp().request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify({ ...validRequest, targetLanguage: "pt" }),
      headers: installationHeaders,
      method: "POST",
    });
    const error = translationErrorSchema.parse(await response.json());

    expect(response.status).toBe(422);
    expect(error.code).toBe("unsupported-pair");
  });

  it("maps the fake adapter failure to a safe retryable error", async () => {
    const response = await createTestApp().request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify({ ...validRequest, text: "simulate failure" }),
      headers: installationHeaders,
      method: "POST",
    });
    const error = translationErrorSchema.parse(await response.json());

    expect(response.status).toBe(503);
    expect(error).toMatchObject({
      code: "provider-unavailable",
      requestId: validRequest.requestId,
      retryable: true,
    });
  });

  it("labels translations made against a stale catalogue", async () => {
    const response = await createGatewayApp({
      capabilityProvider: {
        get: async () => ({ ...fakeCapabilityCatalogue, freshness: "stale" }),
      },
      logger: { info: () => undefined },
      translationAdapter: new FakeTranslationAdapter(0),
    }).request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify(validRequest),
      headers: installationHeaders,
      method: "POST",
    });
    const result = translationResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.warnings).toContainEqual({
      code: "capability-stale",
      message: "Language availability is using the last verified catalogue.",
    });
  });
});
