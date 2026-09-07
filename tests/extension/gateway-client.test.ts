import { createGatewayApp } from "../../apps/gateway/src/app";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import {
  createGatewayClient,
  type GatewayClientError,
  type GatewayFetch,
} from "../../apps/extension/lib/gateway-client";
import type { TranslationRequest } from "../../packages/contracts/src/index";
import { describe, expect, it } from "vitest";

function appFetcher(): GatewayFetch {
  const app = createGatewayApp({ translationAdapter: new FakeTranslationAdapter(0) });
  return async (input, init) => app.request(new Request(input, init));
}

const request: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    nvidiaBackup: false,
    version: "phase-3.1-fake-gateway",
  },
  operation: "translate",
  requestId: "6de8999e-0aad-4ba9-bc94-7cc8bf628126",
  sourceLanguage: "es",
  targetLanguage: "en",
  text: "Gracias",
};

describe("extension gateway client", () => {
  it("validates gateway metadata and translates through the shared contracts", async () => {
    const client = createGatewayClient({
      baseUrl: "http://gateway.test",
      fetcher: appFetcher(),
    });

    const snapshot = await client.inspect();
    const result = await client.translate(request, new AbortController().signal);

    expect(snapshot.health.status).toBe("ok");
    expect(snapshot.version.translationMode).toBe("fake");
    expect(snapshot.capabilities.languages.some((language) => language.code === "es")).toBe(true);
    expect(result.translatedText).toBe("Thank you");
    expect(result.requestId).toBe(request.requestId);
  });

  it("rejects a success response that violates the result contract", async () => {
    const client = createGatewayClient({
      baseUrl: "http://gateway.test",
      fetcher: async () => Response.json({ translatedText: "missing required fields" }),
    });

    await expect(client.translate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "invalid-response",
      name: "GatewayClientError",
      retryable: true,
    } satisfies Partial<GatewayClientError>);
  });
});
