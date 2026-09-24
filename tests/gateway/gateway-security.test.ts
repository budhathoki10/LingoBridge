import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import type { GatewayLogger, GatewayRequestLog } from "../../apps/gateway/src/gateway-logger";
import { MemoryRateLimiter } from "../../apps/gateway/src/rate-limiter";
import { createOriginPolicy, developmentSecurityConfig } from "../../apps/gateway/src/security";
import {
  type TranslationAdapter,
  TranslationAdapterError,
} from "../../apps/gateway/src/translation-adapter";
import {
  ANONYMOUS_INSTALLATION_HEADER,
  GATEWAY_ROUTES,
  MAX_GATEWAY_REQUEST_BYTES,
  MAX_TRANSLATION_REQUEST_CODE_POINTS,
  MAX_TRANSLATION_RESPONSE_UTF8_BYTES,
  type TranslationRequest,
  type TranslationResult,
  translationErrorSchema,
} from "../../packages/contracts/src/index";

const installationId = "2e4858f9-d341-4379-97f7-f24ce4acb364";
const allowedOrigin = `chrome-extension://${"a".repeat(32)}`;
const validRequest: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
    version: "phase-3.2-security",
  },
  operation: "translate",
  requestId: "770937b6-aa54-4751-ab23-db52c1d67073",
  sourceLanguage: "en",
  targetLanguage: "ne",
  text: "Never include this source text in logs or errors.",
};

function translateRequest(
  payload: unknown = validRequest,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request(`http://gateway.test${GATEWAY_ROUTES.translate}`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      [ANONYMOUS_INSTALLATION_HEADER]: installationId,
      ...headers,
    },
    method: "POST",
    signal,
  });
}

function createTestApp(
  overrides: Parameters<typeof createGatewayApp>[0] = {},
  logs: GatewayRequestLog[] = [],
) {
  const logger: GatewayLogger = { info: (event) => logs.push(event) };
  return createGatewayApp({
    logger,
    rateLimiter: new MemoryRateLimiter(),
    translationAdapter: new FakeTranslationAdapter(0),
    ...overrides,
  });
}

describe("gateway request boundary", () => {
  it("requires JSON and a valid anonymous installation identifier", async () => {
    const app = createTestApp();
    const missingContentType = await app.request(
      new Request(`http://gateway.test${GATEWAY_ROUTES.translate}`, {
        body: JSON.stringify(validRequest),
        headers: { [ANONYMOUS_INSTALLATION_HEADER]: installationId },
        method: "POST",
      }),
    );
    const missingInstallation = await app.request(
      new Request(`http://gateway.test${GATEWAY_ROUTES.translate}`, {
        body: JSON.stringify(validRequest),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(missingContentType.status).toBe(415);
    expect(missingInstallation.status).toBe(400);
  });

  it("rejects a request body before parsing when its byte ceiling is exceeded", async () => {
    const response = await createTestApp().request(
      translateRequest({ ...validRequest, text: "a".repeat(MAX_GATEWAY_REQUEST_BYTES) }),
    );

    expect(response.status).toBe(413);
    expect(translationErrorSchema.parse(await response.json()).code).toBe("invalid-request");
  });

  it("enforces exact live extension origins", async () => {
    const app = createTestApp({
      security: {
        ...developmentSecurityConfig,
        originPolicy: createOriginPolicy([allowedOrigin]),
        requireOrigin: true,
      },
    });

    const denied = await app.request(GATEWAY_ROUTES.health, {
      headers: { Origin: `chrome-extension://${"b".repeat(32)}` },
    });
    const allowed = await app.request(GATEWAY_ROUTES.health, {
      headers: { Origin: allowedOrigin },
    });

    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
  });

  it("allows extension fetches with a valid installation header when Chrome omits Origin", async () => {
    const app = createTestApp({
      security: {
        ...developmentSecurityConfig,
        originPolicy: createOriginPolicy([allowedOrigin]),
        requireOrigin: true,
      },
    });

    const denied = await app.request(GATEWAY_ROUTES.health);
    const allowed = await app.request(GATEWAY_ROUTES.health, {
      headers: { [ANONYMOUS_INSTALLATION_HEADER]: installationId },
    });
    const spoofedWebPage = await app.request(GATEWAY_ROUTES.health, {
      headers: {
        [ANONYMOUS_INSTALLATION_HEADER]: installationId,
        Origin: "https://example.com",
      },
    });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(spoofedWebPage.status).toBe(403);
  });

  it("adds no-store and defensive response headers", async () => {
    const response = await createTestApp().request(GATEWAY_ROUTES.health);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Request-Id")).toMatch(/[0-9a-f-]{36}/u);
  });
});

describe("gateway abuse controls", () => {
  it("limits repeated requests by anonymous installation", async () => {
    const app = createTestApp({
      security: {
        ...developmentSecurityConfig,
        installationRateLimit: { limit: 1, windowMilliseconds: 60_000 },
        networkRateLimit: { limit: 10, windowMilliseconds: 60_000 },
      },
    });

    expect((await app.request(translateRequest())).status).toBe(200);
    const limited = await app.request(
      translateRequest({ ...validRequest, requestId: "46f26950-938d-4265-8336-2589dc4b6292" }),
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(translationErrorSchema.parse(await limited.json()).code).toBe("rate-limited");
  });

  it("locks translation for a full minute from the moment the limit is exceeded", async () => {
    let now = Date.parse("2026-09-24T10:00:00.000Z");
    const app = createTestApp({ rateLimiter: new MemoryRateLimiter(() => now) });
    const send = (requestId: string) =>
      app.request(translateRequest({ ...validRequest, requestId }));

    expect((await send("9a1f6a53-5b4e-4c52-9f0e-4a7d8c1b2e01")).status).toBe(200);
    now += 50_000;
    expect((await send("9a1f6a53-5b4e-4c52-9f0e-4a7d8c1b2e02")).status).toBe(200);
    // Only 10 seconds remain of the first window; the wait must still be the full minute.
    now += 5_000;
    const limited = await send("9a1f6a53-5b4e-4c52-9f0e-4a7d8c1b2e03");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(translationErrorSchema.parse(await limited.json())).toMatchObject({
      code: "rate-limited",
      message: "You can translate 2 times a minute. Try again shortly.",
    });

    now += 59_000;
    const stillLocked = await send("9a1f6a53-5b4e-4c52-9f0e-4a7d8c1b2e04");
    expect(stillLocked.status).toBe(429);
    expect(stillLocked.headers.get("Retry-After")).toBe("1");

    now += 1_000;
    expect((await send("9a1f6a53-5b4e-4c52-9f0e-4a7d8c1b2e05")).status).toBe(200);
    expect((await send("9a1f6a53-5b4e-4c52-9f0e-4a7d8c1b2e06")).status).toBe(200);
    expect((await send("9a1f6a53-5b4e-4c52-9f0e-4a7d8c1b2e07")).status).toBe(429);
  });

  it("refuses a translation longer than one request allows", async () => {
    const app = createTestApp();
    const response = await app.request(
      translateRequest({
        ...validRequest,
        text: "a".repeat(MAX_TRANSLATION_REQUEST_CODE_POINTS + 1),
      }),
    );
    expect(response.status).toBe(400);
    expect(translationErrorSchema.parse(await response.json()).code).toBe("invalid-request");
  });

  it("limits different installations sharing a network", async () => {
    const app = createTestApp({
      getClientAddress: () => "203.0.113.10",
      security: {
        ...developmentSecurityConfig,
        installationRateLimit: { limit: 10, windowMilliseconds: 60_000 },
        networkRateLimit: { limit: 1, windowMilliseconds: 60_000 },
      },
    });

    expect((await app.request(translateRequest())).status).toBe(200);
    const limited = await app.request(
      translateRequest(
        { ...validRequest, requestId: "d48cba17-a882-4a84-88bd-7be5af800e3c" },
        { [ANONYMOUS_INSTALLATION_HEADER]: "ba499ba5-5a92-4bcb-8998-eb5160f3627e" },
      ),
    );

    expect(limited.status).toBe(429);
  });
});

describe("gateway provider boundary", () => {
  it("aborts a provider that exceeds its deadline", async () => {
    let providerWasAborted = false;
    const translationAdapter: TranslationAdapter = {
      translate: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              providerWasAborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    };
    const app = createTestApp({
      security: { ...developmentSecurityConfig, providerTimeoutMilliseconds: 5 },
      translationAdapter,
    });

    const response = await app.request(translateRequest());
    const error = translationErrorSchema.parse(await response.json());

    expect(response.status).toBe(504);
    expect(error.code).toBe("timeout");
    expect(providerWasAborted).toBe(true);
  });

  it("propagates request cancellation to provider work", async () => {
    let providerWasAborted = false;
    const translationAdapter: TranslationAdapter = {
      translate: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              providerWasAborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    };
    const controller = new AbortController();
    const responsePromise = createTestApp({ translationAdapter }).request(
      translateRequest(validRequest, {}, controller.signal),
    );
    setTimeout(() => controller.abort(), 0);

    const response = await responsePromise;
    const error = translationErrorSchema.parse(await response.json());

    expect(response.status).toBe(408);
    expect(error.code).toBe("cancelled");
    expect(providerWasAborted).toBe(true);
  });

  it("rejects an oversized provider result", async () => {
    const translationAdapter: TranslationAdapter = {
      async translate(request): Promise<TranslationResult> {
        return {
          detectedSourceLanguage: "en",
          provider: "google",
          requestId: request.requestId,
          targetLanguage: request.targetLanguage,
          translatedText: "न".repeat(MAX_TRANSLATION_RESPONSE_UTF8_BYTES),
          warnings: [],
        };
      },
    };
    const response = await createTestApp({ translationAdapter }).request(translateRequest());
    const error = translationErrorSchema.parse(await response.json());

    expect(response.status).toBe(502);
    expect(error.code).toBe("provider-unavailable");
  });

  it("does not expose provider errors or translation content in responses and logs", async () => {
    const secret = "provider stack and private source must stay server-side";
    const logs: GatewayRequestLog[] = [];
    const translationAdapter: TranslationAdapter = {
      async translate() {
        throw new TranslationAdapterError("provider-unavailable", secret);
      },
    };
    const response = await createTestApp({ translationAdapter }, logs).request(translateRequest());
    const responseBody = await response.text();

    expect(response.status).toBe(503);
    expect(responseBody).not.toContain(secret);
    expect(responseBody).not.toContain(validRequest.text);
    expect(JSON.stringify(logs)).not.toContain(secret);
    expect(JSON.stringify(logs)).not.toContain(validRequest.text);
  });
});
