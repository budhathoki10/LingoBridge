import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../../apps/gateway/src/app";
import type {
  GoogleTranslateTextRequest,
  GoogleTranslateTextResponse,
  GoogleTranslationClient,
} from "../../apps/gateway/src/google-translation-adapter";
import { GoogleTranslationAdapter } from "../../apps/gateway/src/google-translation-adapter";
import { TranslationAdapterError } from "../../apps/gateway/src/translation-adapter";
import {
  ANONYMOUS_INSTALLATION_HEADER,
  GATEWAY_ROUTES,
  type TranslationRequest,
  translationResultSchema,
} from "../../packages/contracts/src/index";

const baseRequest: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
    version: "phase-3-google-online-v1",
  },
  operation: "translate",
  requestId: "077ffeba-b3f0-4d2b-a550-f4b920787bd1",
  sourceLanguage: "auto",
  targetLanguage: "ne",
  text: "Where is the bus stop?",
};

class RecordingClient implements GoogleTranslationClient {
  calls: Array<{ request: GoogleTranslateTextRequest; timeoutMilliseconds: number }> = [];

  constructor(private readonly response: GoogleTranslateTextResponse) {}

  async translateText(request: GoogleTranslateTextRequest, timeoutMilliseconds: number) {
    this.calls.push({ request, timeoutMilliseconds });
    return this.response;
  }
}

describe("GoogleTranslationAdapter", () => {
  it("uses global general NMT and maps automatic detection into the shared result", async () => {
    const client = new RecordingClient({
      translations: [{ detectedLanguageCode: "en", translatedText: "बस स्टप कहाँ छ?" }],
    });
    const adapter = new GoogleTranslationAdapter(client, "lingobridge-test", 8_000);

    const result = await adapter.translate(baseRequest, new AbortController().signal);

    expect(client.calls).toEqual([
      {
        request: {
          contents: [baseRequest.text],
          mimeType: "text/plain",
          model: "projects/lingobridge-test/locations/global/models/general/nmt",
          parent: "projects/lingobridge-test/locations/global",
          targetLanguageCode: "ne",
        },
        timeoutMilliseconds: 8_000,
      },
    ]);
    expect(result).toMatchObject({
      detectedSourceLanguage: "en",
      provider: "google",
      requestId: baseRequest.requestId,
      targetLanguage: "ne",
      translatedText: "बस स्टप कहाँ छ?",
    });
  });

  it("returns the Google result through the protected gateway contract", async () => {
    const client = new RecordingClient({
      translations: [{ detectedLanguageCode: "en", translatedText: "बस स्टप कहाँ छ?" }],
    });
    const app = createGatewayApp({
      logger: { info: () => undefined },
      translationAdapter: new GoogleTranslationAdapter(client, "lingobridge-test", 8_000),
      translationMode: "live",
    });

    const response = await app.request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify(baseRequest),
      headers: {
        "Content-Type": "application/json",
        [ANONYMOUS_INSTALLATION_HEADER]: "dc2bf564-8e12-4fa7-adac-11b8987d3d2b",
      },
      method: "POST",
    });
    const result = translationResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.provider).toBe("google");
    expect(result.translatedText).toBe("बस स्टप कहाँ छ?");
  });

  it("sends an explicit source language and preserves it in the result", async () => {
    const client = new RecordingClient({ translations: [{ translatedText: "Thank you" }] });
    const adapter = new GoogleTranslationAdapter(client, "123456789012", 5_000);

    const result = await adapter.translate(
      { ...baseRequest, sourceLanguage: "es", targetLanguage: "en", text: "Gracias" },
      new AbortController().signal,
    );

    expect(client.calls[0]?.request.sourceLanguageCode).toBe("es");
    expect(result.detectedSourceLanguage).toBe("es");
  });

  it("maps provider failures without exposing their raw details", async () => {
    const rawProviderMessage = "credential and upstream details must stay private";
    const client: GoogleTranslationClient = {
      async translateText() {
        throw Object.assign(new Error(rawProviderMessage), { code: 14 });
      },
    };
    const adapter = new GoogleTranslationAdapter(client, "lingobridge-test", 5_000);

    const error = await adapter
      .translate(baseRequest, new AbortController().signal)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TranslationAdapterError);
    expect((error as Error).message).not.toContain(rawProviderMessage);
    expect(error).toMatchObject({ code: "provider-unavailable", retryable: true });
  });

  it("rejects empty responses and honours cancellation", async () => {
    const emptyAdapter = new GoogleTranslationAdapter(
      new RecordingClient({ translations: [] }),
      "lingobridge-test",
      5_000,
    );
    await expect(
      emptyAdapter.translate(baseRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable" });

    const controller = new AbortController();
    controller.abort();
    await expect(emptyAdapter.translate(baseRequest, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
