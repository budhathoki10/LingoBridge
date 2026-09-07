import {
  GATEWAY_ROUTES,
  capabilityCatalogueSchema,
  gatewayHealthSchema,
  gatewayVersionSchema,
  translationErrorSchema,
  translationResultSchema,
  type TranslationRequest,
} from "../../packages/contracts/src/index";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import { describe, expect, it } from "vitest";

const validRequest: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    nvidiaBackup: false,
    version: "phase-3.1-fake-gateway",
  },
  operation: "translate",
  requestId: "916e3e8b-dc89-46d0-8c0a-e93478257511",
  sourceLanguage: "en",
  targetLanguage: "ne",
  text: "Hello, how are you?",
};

function createTestApp() {
  return createGatewayApp({ translationAdapter: new FakeTranslationAdapter(0) });
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
      nvidiaBackup: false,
      sourceLanguage: "en",
      targetLanguage: "ne",
    });
  });
});

describe("POST /v1/translate", () => {
  it("returns a deterministic contract-valid result from the fake adapter", async () => {
    const response = await createTestApp().request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify(validRequest),
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const error = translationErrorSchema.parse(await response.json());

    expect(response.status).toBe(422);
    expect(error.code).toBe("unsupported-pair");
  });

  it("maps the fake adapter failure to a safe retryable error", async () => {
    const response = await createTestApp().request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify({ ...validRequest, text: "simulate failure" }),
      headers: { "Content-Type": "application/json" },
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
});
