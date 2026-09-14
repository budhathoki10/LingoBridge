import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createGatewayApp } from "./app.js";
import { fakeCapabilityCatalogue } from "./capabilities.js";
import { CapabilityCatalogueService } from "./capability-catalogue-service.js";
import { loadGatewayRuntimeConfig } from "./config.js";
import { FakeTranslationAdapter } from "./fake-translation-adapter.js";
import { FileCapabilityCatalogueStore } from "./file-capability-catalogue-store.js";
import { GoogleCapabilitySource } from "./google-capability-source.js";
import { createGoogleCloudClient, GoogleTranslationAdapter } from "./google-translation-adapter.js";
import { OnlineProviderCapabilitySource } from "./nvidia-capabilities.js";
import { OperationalMetrics, observeTranslationAdapter } from "./operational-metrics.js";
import {
  createNvidiaTranslationClient,
  NvidiaTranslationAdapter,
} from "./nvidia-translation-adapter.js";
import { NvidiaPrimaryProviderRouter } from "./provider-router.js";

const config = loadGatewayRuntimeConfig(process.env);
const liveProjectId = config.translationMode === "live" ? config.googleProjectId : null;
const googleClient = liveProjectId ? createGoogleCloudClient() : null;
const nvidiaClient = config.nvidiaApiKey
  ? createNvidiaTranslationClient({
      apiKey: config.nvidiaApiKey,
      baseUrl: config.nvidiaBaseUrl,
    })
  : null;
const operationsMetrics = new OperationalMetrics();
const translationAdapter =
  config.translationMode === "live" && nvidiaClient
    ? new NvidiaPrimaryProviderRouter({
        google:
          liveProjectId && googleClient
            ? observeTranslationAdapter(
                new GoogleTranslationAdapter(
                  googleClient,
                  liveProjectId,
                  config.security.providerTimeoutMilliseconds,
                ),
                "google",
                operationsMetrics,
              )
            : null,
        nvidia: observeTranslationAdapter(
          new NvidiaTranslationAdapter(nvidiaClient, config.nvidiaModel, config.nvidiaMaxTokens),
          "nvidia",
          operationsMetrics,
        ),
        onBackup: (succeeded) => operationsMetrics.recordFallback(succeeded),
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
          freshForMilliseconds: config.capabilityFreshForMilliseconds,
          retryAfterFailureMilliseconds: config.capabilityRetryAfterFailureMilliseconds,
        },
      )
    : { get: async () => fakeCapabilityCatalogue };
const app = createGatewayApp({
  capabilityProvider,
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
