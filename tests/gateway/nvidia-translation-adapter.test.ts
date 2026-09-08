import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { createNvidiaCapabilityCatalogue } from "../../apps/gateway/src/nvidia-capabilities";
import {
  type NvidiaChatCompletionRequest,
  type NvidiaChatCompletionResponse,
  NvidiaTranslationAdapter,
  type NvidiaTranslationClient,
} from "../../apps/gateway/src/nvidia-translation-adapter";
import { NvidiaPrimaryProviderRouter } from "../../apps/gateway/src/provider-router";
import { TranslationAdapterError } from "../../apps/gateway/src/translation-adapter";
import {
  ANONYMOUS_INSTALLATION_HEADER,
  GATEWAY_ROUTES,
  type TranslationRequest,
  translationResultSchema,
} from "../../packages/contracts/src/index";

const baseRequest: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-08T00:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
    version: "phase-4-nvidia-primary-v1",
  },
  operation: "translate",
  requestId: "c65da980-1ec2-4074-abf7-5f732fe7507d",
  sourceLanguage: "en",
  targetLanguage: "fr",
  text: "Where is the station?",
};

class RecordingNvidiaClient implements NvidiaTranslationClient {
  calls: Array<{ request: NvidiaChatCompletionRequest; signal: AbortSignal }> = [];

  constructor(private readonly response: NvidiaChatCompletionResponse) {}

  async createChatCompletion(request: NvidiaChatCompletionRequest, signal: AbortSignal) {
    this.calls.push({ request, signal });
    return this.response;
  }
}

describe("NvidiaTranslationAdapter", () => {
  it("uses the Riva prompt tag and maps the response into the shared result", async () => {
    const client = new RecordingNvidiaClient({
      choices: [{ message: { content: "Ou est la gare ?" } }],
    });
    const adapter = new NvidiaTranslationAdapter(
      client,
      "nvidia/riva-translate-4b-instruct-v2",
      512,
    );

    const result = await adapter.translate(baseRequest, new AbortController().signal);

    expect(client.calls[0]?.request).toMatchObject({
      max_tokens: 512,
      messages: [
        { content: "en-fr", role: "system" },
        { content: baseRequest.text, role: "user" },
      ],
      model: "nvidia/riva-translate-4b-instruct-v2",
      temperature: 0,
      top_p: 1,
    });
    expect(result).toMatchObject({
      detectedSourceLanguage: "en",
      provider: "nvidia",
      targetLanguage: "fr",
      translatedText: "Ou est la gare ?",
    });
  });

  it("rejects unsupported directions and empty provider output safely", async () => {
    const adapter = new NvidiaTranslationAdapter(
      new RecordingNvidiaClient({ choices: [] }),
      "nvidia/riva-translate-4b-instruct-v2",
      512,
    );

    await expect(
      adapter.translate({ ...baseRequest, targetLanguage: "ne" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable", retryable: false });
    await expect(
      adapter.translate(baseRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
  });

  it("falls back to Google only when backup consent and adapter are present", async () => {
    const failingNvidia = {
      async translate() {
        throw new TranslationAdapterError("provider-unavailable", "nvidia down", true);
      },
    };
    const google = {
      async translate(request: TranslationRequest) {
        return translationResultSchema.parse({
          detectedSourceLanguage: request.sourceLanguage,
          provider: "google",
          requestId: request.requestId,
          targetLanguage: request.targetLanguage,
          translatedText: "French fallback",
          warnings: [],
        });
      },
    };
    const router = new NvidiaPrimaryProviderRouter({ google, nvidia: failingNvidia });

    await expect(
      router.translate(baseRequest, new AbortController().signal),
    ).resolves.toMatchObject({ provider: "google", translatedText: "French fallback" });
    await expect(
      router.translate(
        { ...baseRequest, consent: { ...baseRequest.consent, googleBackup: false } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
  });

  it("returns NVIDIA through the protected gateway when only NVIDIA is configured", async () => {
    const client = new RecordingNvidiaClient({
      choices: [{ message: { content: "Gracias" } }],
    });
    const app = createGatewayApp({
      capabilityProvider: {
        get: async () => createNvidiaCapabilityCatalogue(new Date("2026-09-08T00:00:00.000Z")),
      },
      logger: { info: () => undefined },
      translationAdapter: new NvidiaPrimaryProviderRouter({
        google: null,
        nvidia: new NvidiaTranslationAdapter(client, "nvidia/riva-translate-4b-instruct-v2", 512),
      }),
      translationMode: "live",
    });

    const response = await app.request(GATEWAY_ROUTES.translate, {
      body: JSON.stringify({ ...baseRequest, targetLanguage: "es-ES" }),
      headers: {
        "Content-Type": "application/json",
        [ANONYMOUS_INSTALLATION_HEADER]: "319c4b9c-ddb0-4c86-8292-6682e80f0c8e",
      },
      method: "POST",
    });
    const result = translationResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.provider).toBe("nvidia");
    expect(result.translatedText).toBe("Gracias");
  });
});
