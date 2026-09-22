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
import { logProviderFailure } from "./gateway-logger.js";
import { GoogleCapabilitySource } from "./google-capability-source.js";
import { createGoogleCloudClient } from "./google-translation-adapter.js";
import {
  createMyMemoryClient,
  MyMemoryTranslationAdapter,
} from "./mymemory-translation-adapter.js";
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
import { MyMemoryPrimaryProviderRouter } from "./provider-router.js";

const config = loadGatewayRuntimeConfig(process.env);
const liveProjectId = config.translationMode === "live" ? config.googleProjectId : null;
const googleClient = liveProjectId ? createGoogleCloudClient() : null;
const myMemoryClient = createMyMemoryClient(config.myMemoryBaseUrl, {
  privateKey: config.myMemoryPrivateKey,
  rapidApiHost: config.myMemoryRapidApiHost,
  rapidApiKey: config.myMemoryRapidApiKey,
});
const myMemoryContactEmail = config.myMemoryContactEmail;
const nvidiaClient = config.nvidiaApiKey
  ? createNvidiaTranslationClient({
      apiKey: config.nvidiaApiKey,
      baseUrl: config.nvidiaBaseUrl,
    })
  : null;
const operationsMetrics = new OperationalMetrics();
const translationAdapter =
  config.translationMode === "live" && nvidiaClient && myMemoryContactEmail
    ? new MyMemoryPrimaryProviderRouter({
        myMemory: observeTranslationAdapter(
          new MyMemoryTranslationAdapter(myMemoryClient, myMemoryContactEmail, (failure) =>
            logProviderFailure({ ...failure, provider: "mymemory" }),
          ),
          "mymemory",
          operationsMetrics,
        ),
        nvidia: observeTranslationAdapter(
          new NvidiaTranslationAdapter(nvidiaClient, config.nvidiaModel, config.nvidiaMaxTokens),
          "nvidia",
          operationsMetrics,
        ),
        onFallback: (succeeded) => operationsMetrics.recordFallback("nvidia", succeeded),
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
