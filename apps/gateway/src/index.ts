import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createGatewayApp } from "./app.js";
import { fakeCapabilityCatalogue } from "./capabilities.js";
import { CapabilityCatalogueService } from "./capability-catalogue-service.js";
import { loadGatewayRuntimeConfig } from "./config.js";
import { FakeExplanationAdapter } from "./fake-explanation-adapter.js";
import { FakeTranslationAdapter } from "./fake-translation-adapter.js";
import { FallbackExplanationAdapter } from "./fallback-explanation-adapter.js";
import { FileCapabilityCatalogueStore } from "./file-capability-catalogue-store.js";
import { logProviderFailure, logTranslationStep } from "./gateway-logger.js";
import { GoogleCapabilitySource } from "./google-capability-source.js";
import { createGoogleCloudClient } from "./google-translation-adapter.js";
import {
  createMyMemoryClient,
  type MyMemoryClient,
  MyMemoryTranslationAdapter,
} from "./mymemory-translation-adapter.js";
import { NemotronTranslationAdapter } from "./nemotron-translation-adapter.js";
import {
  isCurrentOnlineCapabilityCatalogue,
  OnlineProviderCapabilitySource,
} from "./nvidia-capabilities.js";
import { NvidiaExplanationAdapter } from "./nvidia-explanation-adapter.js";
import { OperationalMetrics, observeTranslationAdapter } from "./operational-metrics.js";
import {
  createNvidiaTranslationClient,
  NvidiaTranslationAdapter,
} from "./nvidia-translation-adapter.js";
import { createTranslationChain } from "./provider-router.js";

const config = loadGatewayRuntimeConfig(process.env);
const liveProjectId = config.translationMode === "live" ? config.googleProjectId : null;
const googleClient = liveProjectId ? createGoogleCloudClient() : null;
// The free public endpoint is asked before the RapidAPI subscription, so the subscription's
// monthly allowance is spent only on days the public per-IP quota has run out.
const myMemoryPublicClient = createMyMemoryClient(config.myMemoryBaseUrl, {
  privateKey: config.myMemoryPrivateKey,
});
const myMemoryRapidApiClient =
  config.myMemoryRapidApiKey && config.myMemoryRapidApiHost
    ? createMyMemoryClient(config.myMemoryBaseUrl, {
        privateKey: config.myMemoryPrivateKey,
        rapidApiHost: config.myMemoryRapidApiHost,
        rapidApiKey: config.myMemoryRapidApiKey,
      })
    : null;
const myMemoryContactEmail = config.myMemoryContactEmail;
const nvidiaClient = config.nvidiaApiKey
  ? createNvidiaTranslationClient({
      apiKey: config.nvidiaApiKey,
      baseUrl: config.nvidiaBaseUrl,
    })
  : null;
const operationsMetrics = new OperationalMetrics();
/** "42s" under two minutes, "58 min" above, so rest periods read naturally in the log. */
const formatWait = (seconds: number) =>
  seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
const myMemoryAdapter = (
  client: MyMemoryClient,
  contactEmail: string,
  endpoint: "public" | "rapidapi",
) =>
  observeTranslationAdapter(
    new MyMemoryTranslationAdapter(client, contactEmail, (failure) =>
      logProviderFailure({ ...failure, endpoint, provider: "mymemory" }),
    ),
    "mymemory",
    operationsMetrics,
  );
const translationAdapter =
  config.translationMode === "live" && nvidiaClient && myMemoryContactEmail
    ? createTranslationChain({
        myMemoryPublic: myMemoryAdapter(myMemoryPublicClient, myMemoryContactEmail, "public"),
        myMemoryRapidApi: myMemoryRapidApiClient
          ? myMemoryAdapter(myMemoryRapidApiClient, myMemoryContactEmail, "rapidapi")
          : null,
        nemotron: observeTranslationAdapter(
          new NemotronTranslationAdapter(
            nvidiaClient,
            config.explanationModel,
            config.explanationMaxTokens,
          ),
          "nvidia",
          operationsMetrics,
        ),
        // Never more than half the whole translation budget, so MyMemory always gets its turn.
        nemotronTimeoutMilliseconds: Math.min(
          config.translationPrimaryTimeoutMilliseconds,
          Math.floor(config.security.providerTimeoutMilliseconds / 2),
        ),
        onFallback: (provider, succeeded) => operationsMetrics.recordFallback(provider, succeeded),
        onStep: ({ durationMilliseconds, label, outcome, pair, reason, restSeconds, step }) =>
          logTranslationStep({
            durationMilliseconds,
            message:
              outcome === "calling"
                ? `Calling ${label} (step ${step})`
                : outcome === "answered"
                  ? `${label} answered in ${durationMilliseconds} ms`
                  : outcome === "skipped"
                    ? `Skipping ${label} (${reason}; retry in ${formatWait(restSeconds ?? 0)})`
                    : `${label} failed after ${durationMilliseconds} ms (${reason})${
                        restSeconds ? `; resting for ${formatWait(restSeconds)}` : ""
                      }`,
            outcome,
            pair,
            reason,
            restSeconds,
            step,
            translator: label,
          }),
        riva: observeTranslationAdapter(
          new NvidiaTranslationAdapter(nvidiaClient, config.nvidiaModel, config.nvidiaMaxTokens),
          "nvidia",
          operationsMetrics,
        ),
      })
    : observeTranslationAdapter(new FakeTranslationAdapter(), "fake", operationsMetrics);
const capabilityProvider =
  config.translationMode === "live"
    ? new CapabilityCatalogueService(
        new OnlineProviderCapabilitySource(
          liveProjectId && googleClient
            ? new GoogleCapabilitySource(
                googleClient,
                liveProjectId,
                config.security.providerTimeoutMilliseconds,
              )
            : null,
        ),
        new FileCapabilityCatalogueStore(config.capabilityCachePath),
        {
          acceptStoredCatalogue: isCurrentOnlineCapabilityCatalogue,
          freshForMilliseconds: config.capabilityFreshForMilliseconds,
          retryAfterFailureMilliseconds: config.capabilityRetryAfterFailureMilliseconds,
        },
      )
    : { get: async () => fakeCapabilityCatalogue };
// Live explanations reuse the NVIDIA key and client that translation already requires.
const nvidiaExplanationAdapter =
  config.translationMode === "live" && nvidiaClient
    ? new NvidiaExplanationAdapter(
        nvidiaClient,
        config.explanationModel,
        config.explanationMaxTokens,
      )
    : null;
// OpenRouter speaks the same chat-completions format, so the NVIDIA client is reused with its URL.
const openRouterExplanationAdapter = config.openRouterApiKey
  ? new NvidiaExplanationAdapter(
      createNvidiaTranslationClient({
        apiKey: config.openRouterApiKey,
        baseUrl: config.openRouterBaseUrl,
      }),
      config.openRouterModel,
      config.explanationMaxTokens,
      750,
      "openrouter",
    )
  : null;
const explanationAdapter =
  nvidiaExplanationAdapter && openRouterExplanationAdapter
    ? new FallbackExplanationAdapter({
        fallback: openRouterExplanationAdapter,
        primary: nvidiaExplanationAdapter,
        primaryTimeoutMilliseconds: config.explanationPrimaryTimeoutMilliseconds,
      })
    : (nvidiaExplanationAdapter ??
      (config.translationMode === "fake" ? new FakeExplanationAdapter() : null));
const app = createGatewayApp({
  capabilityProvider,
  explanationAdapter,
  explanationTimeoutMilliseconds: config.explanationTimeoutMilliseconds,
  getClientAddress: (context) => getConnInfo(context).remote.address ?? "unknown-network",
  operationsMetrics,
  operationsMetricsToken: config.operationsMetricsToken,
  operationsThresholds: config.operationsThresholds,
  security: config.security,
  serviceVersion: config.serviceVersion,
  translationAdapter,
  translationMode: config.translationMode,
});

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.hostname,
    port: config.port,
  },
  () => {
    console.info(
      `[LingoBridge] ${config.translationMode} gateway listening on http://${config.hostname}:${config.port}`,
    );
  },
);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[LingoBridge] Cannot start: http://${config.hostname}:${config.port} is already in use. Stop the existing gateway or choose another PORT.`,
    );
  } else {
    console.error(`[LingoBridge] Gateway failed to start: ${error.message}`);
  }
  process.exitCode = 1;
});
