import {
  OPERATIONS_METRICS_ROUTE,
  operationsMetricsSchema,
} from "@lingobridge/contracts/operations";
import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import {
  observeTranslationAdapter,
  OperationalMetrics,
} from "../../apps/gateway/src/operational-metrics";
import { createTranslationChain } from "../../apps/gateway/src/provider-router";
import { TranslationAdapterError } from "../../apps/gateway/src/translation-adapter";
import {
  ANONYMOUS_INSTALLATION_HEADER,
  type TranslationRequest,
} from "../../packages/contracts/src/index";

const METRICS_TOKEN = "metrics-token-that-is-long-enough-000000";
const SECRET_TEXT = "My bank PIN is 4321 and my address is 12 Hidden Lane";

const request: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
    version: "test",
  },
  operation: "translate",
  requestId: "916e3e8b-dc89-46d0-8c0a-e93478257511",
  sourceLanguage: "en",
  targetLanguage: "fr",
  text: SECRET_TEXT,
};

function app(metrics: OperationalMetrics, token: string | null = METRICS_TOKEN) {
  return createGatewayApp({
    logger: { info: () => undefined },
    operationsMetrics: metrics,
    operationsMetricsToken: token,
    translationAdapter: observeTranslationAdapter(new FakeTranslationAdapter(0), "fake", metrics),
  });
}

async function translate(gateway: ReturnType<typeof app>, body: unknown) {
  return gateway.request("/v1/translate", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      [ANONYMOUS_INSTALLATION_HEADER]: "1fb7891e-277d-4cba-aaf9-f7d33703f67e",
    },
    method: "POST",
  });
}

describe("operations metrics route", () => {
  it("is disabled without a configured token and refuses wrong tokens", async () => {
    const metrics = new OperationalMetrics();
    expect((await app(metrics, null).request(OPERATIONS_METRICS_ROUTE)).status).toBe(404);
    expect((await app(metrics).request(OPERATIONS_METRICS_ROUTE)).status).toBe(401);
    expect(
      (
        await app(metrics).request(OPERATIONS_METRICS_ROUTE, {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
  });

  it("aggregates outcomes without any request text", async () => {
    const metrics = new OperationalMetrics();
    const gateway = app(metrics);
    expect((await translate(gateway, request)).status).toBe(200);
    expect((await translate(gateway, { ...request, requestId: "not-a-uuid" })).status).toBe(400);

    const response = await gateway.request(OPERATIONS_METRICS_ROUTE, {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("bank");
    expect(raw).not.toContain("4321");
    expect(raw).not.toContain("1fb7891e");
    const snapshot = operationsMetricsSchema.parse(JSON.parse(raw));

    const fake = snapshot.providers.find((provider) => provider.provider === "fake");
    expect(fake).toMatchObject({ billableCharacters: Array.from(SECRET_TEXT).length, requests: 1 });
    expect(fake?.outcomes.success).toBe(1);
    expect(
      snapshot.providers.find((provider) => provider.provider === "none")?.outcomes[
        "invalid-request"
      ],
    ).toBe(1);
    expect(snapshot.languagePairs).toEqual([
      { provider: "fake", requests: 1, sourceLanguage: "en", targetLanguage: "fr" },
    ]);
  });
});

describe("OperationalMetrics", () => {
  it("computes percentiles and warns when a provider keeps failing", () => {
    let clock = 0;
    const metrics = new OperationalMetrics(() => clock);
    for (let index = 1; index <= 20; index += 1) {
      metrics.recordAttempt({
        characters: 10,
        latencyMilliseconds: index * 10,
        outcome: "success",
        provider: "nvidia",
        sourceLanguage: "en",
        targetLanguage: "fr",
      });
    }
    for (let index = 0; index < 5; index += 1) {
      metrics.recordAttempt({
        characters: 10,
        latencyMilliseconds: 900,
        outcome: "provider-error",
        provider: "google",
        sourceLanguage: "en",
        targetLanguage: "ne",
      });
    }
    const snapshot = metrics.snapshot("live", {
      characterQuota: 150,
      costWarningUsd: null,
      googlePricePerMillionCharactersUsd: 20,
      nvidiaPricePerMillionCharactersUsd: 0,
    });
    const nvidia = snapshot.providers.find((provider) => provider.provider === "nvidia");
    expect(nvidia).toMatchObject({
      billableCharacters: 200,
      latencyMedianMs: 100,
      latencyP95Ms: 190,
    });
    expect(
      snapshot.warnings.map((warning) => `${warning.provider}:${warning.code}`).sort(),
    ).toEqual(["google:provider-down", "nvidia:quota-near-limit"]);

    clock += 24 * 60 * 60 * 1_000;
    expect(metrics.snapshot("live").providers).toEqual([]);
  });

  it("counts fallback attempts and outcomes through the translation chain", async () => {
    const metrics = new OperationalMetrics();
    const failingNemotron = {
      translate: async () => {
        throw new TranslationAdapterError("provider-unavailable", "down");
      },
    };
    const router = createTranslationChain({
      myMemoryPublic: observeTranslationAdapter(new FakeTranslationAdapter(0), "mymemory", metrics),
      myMemoryRapidApi: null,
      nemotron: observeTranslationAdapter(failingNemotron, "nvidia", metrics),
      nemotronTimeoutMilliseconds: 1_000,
      onFallback: (provider, succeeded) => metrics.recordFallback(provider, succeeded),
      riva: observeTranslationAdapter(new FakeTranslationAdapter(0), "nvidia", metrics),
    });
    await router.translate(
      {
        ...request,
        consent: { ...request.consent, myMemory: true, nvidiaBackup: true },
        targetLanguage: "de",
      },
      new AbortController().signal,
    );
    const snapshot = metrics.snapshot("live");
    expect(snapshot.providers.find((provider) => provider.provider === "mymemory")).toMatchObject({
      fallbackAttempts: 1,
      fallbackSuccesses: 1,
    });
    expect(
      snapshot.providers.find((provider) => provider.provider === "nvidia")?.outcomes[
        "provider-error"
      ],
    ).toBe(1);
  });
});
