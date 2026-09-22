import { describe, expect, it, vi } from "vitest";
import {
  createGatewayClient,
  type GatewayClientError,
  type GatewayFetch,
} from "../../apps/extension/lib/gateway-client";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import type { TranslationRequest } from "../../packages/contracts/src/index";

function appFetcher(): GatewayFetch {
  const app = createGatewayApp({
    logger: { info: () => undefined },
    translationAdapter: new FakeTranslationAdapter(0),
  });
  return async (input, init) => app.request(new Request(input, init));
}

const request: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
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
      installationIdProvider: async () => "51e8bfee-b285-46ba-928c-44e914935634",
    });

    const snapshot = await client.inspect();
    const result = await client.translate(request, new AbortController().signal);

    expect(snapshot.health.status).toBe("ok");
    expect(snapshot.version.translationMode).toBe("fake");
    expect(snapshot.capabilities.languages.some((language) => language.code === "es")).toBe(true);
    expect(result.translatedText).toBe("Thank you");
    expect(result.requestId).toBe(request.requestId);
  });

  it("retries a body the gateway did not write, then reports an unreachable service", async () => {
    let attempts = 0;
    const client = createGatewayClient({
      baseUrl: "https://gateway.example",
      fetcher: async () => {
        attempts += 1;
        return new Response("<html>Service Unavailable</html>", {
          headers: { "Content-Type": "text/html" },
          status: 503,
        });
      },
      installationIdProvider: async () => "51e8bfee-b285-46ba-928c-44e914935634",
    });

    vi.useFakeTimers();
    try {
      const pending = client.translate(request, new AbortController().signal);
      const settled = expect(pending).rejects.toMatchObject({
        code: "network-unavailable",
        name: "GatewayClientError",
        retryable: true,
      } satisfies Partial<GatewayClientError>);
      await vi.advanceTimersByTimeAsync(60_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
    expect(attempts).toBe(6);
  });

  it("recovers when the gateway answers a later attempt", async () => {
    let attempts = 0;
    const client = createGatewayClient({
      baseUrl: "https://gateway.example",
      fetcher: async (input, init) => {
        attempts += 1;
        if (attempts === 1) return new Response("502 Bad Gateway", { status: 502 });
        return appFetcher()(input, init);
      },
      installationIdProvider: async () => "51e8bfee-b285-46ba-928c-44e914935634",
    });

    vi.useFakeTimers();
    try {
      const pending = client.translate(request, new AbortController().signal);
      const settled = expect(pending).resolves.toMatchObject({ translatedText: "Thank you" });
      await vi.advanceTimersByTimeAsync(60_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
    expect(attempts).toBe(2);
  });

  it("surfaces a gateway error without spending a second provider call", async () => {
    let attempts = 0;
    const client = createGatewayClient({
      baseUrl: "https://gateway.example",
      fetcher: async () => {
        attempts += 1;
        return Response.json(
          {
            code: "provider-unavailable",
            message: "The translation provider is temporarily unavailable.",
            requestId: request.requestId,
            retryable: true,
          },
          { status: 503 },
        );
      },
      installationIdProvider: async () => "51e8bfee-b285-46ba-928c-44e914935634",
    });

    await expect(client.translate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "provider-unavailable",
      name: "GatewayClientError",
    } satisfies Partial<GatewayClientError>);
    expect(attempts).toBe(1);
  });

  it("stops retrying as soon as the caller aborts", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const client = createGatewayClient({
      baseUrl: "https://gateway.example",
      fetcher: async () => {
        attempts += 1;
        controller.abort();
        return new Response("504 Gateway Timeout", { status: 504 });
      },
      installationIdProvider: async () => "51e8bfee-b285-46ba-928c-44e914935634",
    });

    await expect(client.translate(request, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(attempts).toBe(1);
  });

  it("rejects a success response that violates the result contract", async () => {
    const client = createGatewayClient({
      baseUrl: "http://gateway.test",
      fetcher: async () => Response.json({ translatedText: "missing required fields" }),
      installationIdProvider: async () => "51e8bfee-b285-46ba-928c-44e914935634",
    });

    await expect(client.translate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "invalid-response",
      name: "GatewayClientError",
      retryable: true,
    } satisfies Partial<GatewayClientError>);
  });
});
