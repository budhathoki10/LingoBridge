import {
  ANONYMOUS_INSTALLATION_HEADER,
  anonymousInstallationIdSchema,
  type CapabilityCatalogue,
  explanationRequestSchema,
  explanationResultSchema,
  GATEWAY_API_VERSION,
  GATEWAY_ROUTES,
  gatewayHealthSchema,
  gatewayVersionSchema,
  MAX_GATEWAY_REQUEST_BYTES,
  requestIdSchema,
  type TranslationError,
  translationErrorSchema,
  translationRequestSchema,
  translationResultSchema,
  wordUnderstandingRequestSchema,
  wordUnderstandingResultSchema,
} from "@lingobridge/contracts";
import { OPERATIONS_METRICS_ROUTE } from "@lingobridge/contracts/operations";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { fakeCapabilityCatalogue, supportsTranslation } from "./capabilities.js";
import type { ExplanationAdapter } from "./explanation-adapter.js";
import { FakeExplanationAdapter } from "./fake-explanation-adapter.js";
import { FakeTranslationAdapter } from "./fake-translation-adapter.js";
import {
  consoleGatewayLogger,
  type GatewayLogger,
  requestAuditMiddleware,
} from "./gateway-logger.js";
import { safeEqualSecret } from "./internal-auth.js";
import {
  DEFAULT_OPERATIONS_THRESHOLDS,
  type OperationalMetrics,
  type OperationsThresholds,
} from "./operational-metrics.js";
import { ProviderInterruptedError, runWithProviderDeadline } from "./provider-deadline.js";
import { MemoryRateLimiter, type RateLimiter } from "./rate-limiter.js";
import { developmentSecurityConfig, type GatewaySecurityConfig } from "./security.js";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

export interface GatewayDependencies {
  capabilityProvider: {
    get(signal: AbortSignal): Promise<CapabilityCatalogue>;
  };
  /** Null when no explanation provider is configured; the route then answers 503. */
  explanationAdapter: ExplanationAdapter | null;
  /** A general model writes more than a translation, so it gets its own, longer deadline. */
  explanationTimeoutMilliseconds: number;
  getClientAddress: (context: Context) => string;
  logger: GatewayLogger;
  /** Content-free aggregates for the admin view; null disables recording. */
  operationsMetrics: OperationalMetrics | null;
  operationsThresholds: OperationsThresholds;
  /** Server-to-server bearer secret for the metrics route; null keeps the route disabled. */
  operationsMetricsToken: string | null;
  rateLimiter: RateLimiter;
  security: GatewaySecurityConfig;
  serviceVersion: string;
  translationAdapter: TranslationAdapter;
  translationMode: "fake" | "live";
}

const defaultDependencies: GatewayDependencies = {
  capabilityProvider: { get: async () => fakeCapabilityCatalogue },
  explanationAdapter: new FakeExplanationAdapter(),
  explanationTimeoutMilliseconds: 90_000,
  getClientAddress: () => "unknown-network",
  logger: consoleGatewayLogger,
  operationsMetrics: null,
  operationsMetricsToken: null,
  operationsThresholds: DEFAULT_OPERATIONS_THRESHOLDS,
  rateLimiter: new MemoryRateLimiter(),
  security: developmentSecurityConfig,
  serviceVersion: "0.1.0",
  translationAdapter: new FakeTranslationAdapter(),
  translationMode: "fake",
};

function safeRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("requestId" in value)) return null;
  const parsed = requestIdSchema.safeParse(Reflect.get(value, "requestId"));
  return parsed.success ? parsed.data : null;
}

function createError(
  code: TranslationError["code"],
  message: string,
  requestId: string | null,
  retryable: boolean,
): TranslationError {
  return translationErrorSchema.parse({ code, message, requestId, retryable });
}

function invalidRequest(context: Context, message: string, status: 400 | 403 | 413 | 415) {
  return context.json(createError("invalid-request", message, null, false), status);
}

function checkRateLimit(
  context: Context,
  dependencies: GatewayDependencies,
  installationId: string,
): Response | undefined {
  const networkDecision = dependencies.rateLimiter.consume(
    "network",
    dependencies.getClientAddress(context),
    dependencies.security.networkRateLimit,
  );
  const installationDecision = dependencies.rateLimiter.consume(
    "installation",
    installationId,
    dependencies.security.installationRateLimit,
  );

  if (networkDecision.allowed && installationDecision.allowed) return undefined;

  const retryAfterSeconds = Math.max(
    networkDecision.allowed ? 0 : networkDecision.retryAfterSeconds,
    installationDecision.allowed ? 0 : installationDecision.retryAfterSeconds,
  );
  context.header("Retry-After", String(retryAfterSeconds));
  return context.json(
    createError(
      "rate-limited",
      "Too many translation requests. Wait briefly and try again.",
      null,
      true,
    ),
    429,
  );
}

type AcceptedPost =
  | { ok: true; payload: unknown }
  | { ok: false; rateLimited: boolean; response: Response };

/** Content type, installation identifier, rate limits, then JSON parsing, in that order. */
async function acceptJsonPost(
  context: Context,
  dependencies: GatewayDependencies,
): Promise<AcceptedPost> {
  if (!context.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      rateLimited: false,
      response: invalidRequest(context, "Expected an application/json request body.", 415),
    };
  }

  const installationId = anonymousInstallationIdSchema.safeParse(
    context.req.header(ANONYMOUS_INSTALLATION_HEADER),
  );
  if (!installationId.success) {
    return {
      ok: false,
      rateLimited: false,
      response: invalidRequest(
        context,
        "A valid anonymous installation identifier is required.",
        400,
      ),
    };
  }

  const rateLimitResponse = checkRateLimit(context, dependencies, installationId.data);
  if (rateLimitResponse) return { ok: false, rateLimited: true, response: rateLimitResponse };

  try {
    return { ok: true, payload: await context.req.json() };
  } catch {
    return {
      ok: false,
      rateLimited: false,
      response: context.json(
        createError("invalid-request", "Expected a valid JSON request body.", null, false),
        400,
      ),
    };
  }
}

function providerFailure(
  context: Context,
  error: unknown,
  requestId: string,
  work: "translation" | "explanation" | "word understanding",
) {
  const cancelled = () =>
    context.json(
      createError("cancelled", `The ${work} request was cancelled.`, requestId, true),
      408,
    );
  const timedOut = () =>
    context.json(
      createError("timeout", `The ${work} provider took too long to respond.`, requestId, true),
      504,
    );

  if (error instanceof ProviderInterruptedError) {
    return error.reason === "timeout" ? timedOut() : cancelled();
  }
  if (error instanceof TranslationAdapterError) {
    if (error.code === "timeout") return timedOut();
    return context.json(
      createError(
        error.code,
        // Adapter messages are content-free; explanations surface them so a refusal is not
        // reported as an outage. Translation keeps its established wording.
        work === "explanation" ? error.message : `The ${work} provider is temporarily unavailable.`,
        requestId,
        error.retryable,
      ),
      503,
    );
  }
  if (error instanceof DOMException && error.name === "AbortError") return cancelled();
  return context.json(
    createError("internal-error", `The gateway could not complete the ${work}.`, requestId, true),
    500,
  );
}

export function createGatewayApp(dependencies: Partial<GatewayDependencies> = {}): Hono {
  const resolvedDependencies = {
    ...defaultDependencies,
    ...dependencies,
    rateLimiter: dependencies.rateLimiter ?? new MemoryRateLimiter(),
  };
  const app = new Hono();

  app.use("/v1/*", requestAuditMiddleware(resolvedDependencies.logger));
  app.use("/v1/*", secureHeaders());
  app.use(
    "/v1/*",
    cors({
      allowHeaders: ["Content-Type", ANONYMOUS_INSTALLATION_HEADER],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
      origin: (origin) => resolvedDependencies.security.originPolicy.corsOrigin(origin),
    }),
  );
  app.use("/v1/*", async (context, next) => {
    // The metrics route is called server to server by the dashboard and authenticates with its
    // own bearer secret instead of an extension origin.
    if (context.req.path === OPERATIONS_METRICS_ROUTE) {
      await next();
      return;
    }
    const origin = context.req.header("Origin");
    const hasExtensionInstallationHeader = anonymousInstallationIdSchema.safeParse(
      context.req.header(ANONYMOUS_INSTALLATION_HEADER),
    ).success;
    if (!resolvedDependencies.security.requireOrigin) {
      await next();
      return;
    }
    if (resolvedDependencies.security.originPolicy.allows(origin)) {
      await next();
      return;
    }
    if (origin || !hasExtensionInstallationHeader) {
      return invalidRequest(context, "The request origin is not allowed.", 403);
    }
    await next();
  });
  app.use("/v1/*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });

  app.get("/", (context) =>
    context.json({
      routes: GATEWAY_ROUTES,
      service: "lingobridge-gateway",
      status: resolvedDependencies.translationMode === "live" ? "ready" : "fake-provider",
    }),
  );

  app.get(GATEWAY_ROUTES.health, (context) =>
    context.json(
      gatewayHealthSchema.parse({
        service: "lingobridge-gateway",
        status: "ok",
      }),
    ),
  );

  app.get(GATEWAY_ROUTES.version, (context) =>
    context.json(
      gatewayVersionSchema.parse({
        apiVersion: GATEWAY_API_VERSION,
        serviceVersion: resolvedDependencies.serviceVersion,
        translationMode: resolvedDependencies.translationMode,
      }),
    ),
  );

  app.get(OPERATIONS_METRICS_ROUTE, (context) => {
    const expected = resolvedDependencies.operationsMetricsToken;
    const metrics = resolvedDependencies.operationsMetrics;
    if (!expected || !metrics) return context.json({ error: "not-found" }, 404);
    const presented = /^Bearer (.+)$/u.exec(context.req.header("Authorization") ?? "")?.[1];
    if (!presented || !safeEqualSecret(presented, expected)) {
      return context.json({ error: "unauthorized" }, 401);
    }
    return context.json(
      metrics.snapshot(
        resolvedDependencies.translationMode,
        resolvedDependencies.operationsThresholds,
      ),
    );
  });

  const recordRejected = (
    outcome: "invalid-request" | "rate-limited" | "unsupported-pair",
    sourceLanguage = "auto",
    targetLanguage = "",
  ) =>
    resolvedDependencies.operationsMetrics?.recordAttempt({
      characters: 0,
      latencyMilliseconds: null,
      outcome,
      provider: "none",
      sourceLanguage,
      targetLanguage,
    });

  app.get(GATEWAY_ROUTES.capabilities, async (context) => {
    try {
      return context.json(
        await resolvedDependencies.capabilityProvider.get(context.req.raw.signal),
      );
    } catch {
      return context.json(
        createError(
          "provider-unavailable",
          "The language catalogue is temporarily unavailable.",
          null,
          true,
        ),
        503,
      );
    }
  });

  app.post(
    GATEWAY_ROUTES.translate,
    bodyLimit({
      maxSize: MAX_GATEWAY_REQUEST_BYTES,
      onError: (context) =>
        invalidRequest(context, "The translation request body is too large.", 413),
    }),
    async (context) => {
      const accepted = await acceptJsonPost(context, resolvedDependencies);
      if (!accepted.ok) {
        if (accepted.rateLimited) recordRejected("rate-limited");
        return accepted.response;
      }
      const payload = accepted.payload;

      const parsedRequest = translationRequestSchema.safeParse(payload);
      if (!parsedRequest.success) {
        recordRejected("invalid-request");
        return context.json(
          createError(
            "invalid-request",
            "The translation request did not match the supported contract.",
            safeRequestId(payload),
            false,
          ),
          400,
        );
      }

      const request = parsedRequest.data;
      let capabilities: CapabilityCatalogue;
      try {
        capabilities = await resolvedDependencies.capabilityProvider.get(context.req.raw.signal);
      } catch {
        return context.json(
          createError(
            "provider-unavailable",
            "The language catalogue is temporarily unavailable.",
            request.requestId,
            true,
          ),
          503,
        );
      }
      if (!supportsTranslation(capabilities, request.sourceLanguage, request.targetLanguage)) {
        recordRejected("unsupported-pair", request.sourceLanguage, request.targetLanguage);
        return context.json(
          createError(
            "unsupported-pair",
            "The requested language direction is not in the active capability catalogue.",
            request.requestId,
            false,
          ),
          422,
        );
      }

      try {
        const result = await runWithProviderDeadline(
          (signal) => resolvedDependencies.translationAdapter.translate(request, signal),
          context.req.raw.signal,
          resolvedDependencies.security.providerTimeoutMilliseconds,
        );
        const parsedResult = translationResultSchema.safeParse(result);
        if (!parsedResult.success) {
          return context.json(
            createError(
              "provider-unavailable",
              "The translation provider returned an unusable response.",
              request.requestId,
              true,
            ),
            502,
          );
        }
        if (capabilities.freshness === "stale") {
          return context.json({
            ...parsedResult.data,
            warnings: [
              ...parsedResult.data.warnings,
              {
                code: "capability-stale" as const,
                message: "Language availability is using the last verified catalogue.",
              },
            ],
          });
        }
        return context.json(parsedResult.data);
      } catch (error) {
        return providerFailure(context, error, request.requestId, "translation");
      }
    },
  );

  app.post(
    GATEWAY_ROUTES.understandWord,
    bodyLimit({
      maxSize: MAX_GATEWAY_REQUEST_BYTES,
      onError: (context) =>
        invalidRequest(context, "The word-understanding request body is too large.", 413),
    }),
    async (context) => {
      const accepted = await acceptJsonPost(context, resolvedDependencies);
      if (!accepted.ok) return accepted.response;
      const parsedRequest = wordUnderstandingRequestSchema.safeParse(accepted.payload);
      if (!parsedRequest.success) {
        return context.json(
          createError(
            "invalid-request",
            "The word-understanding request did not match the supported contract.",
            safeRequestId(accepted.payload),
            false,
          ),
          400,
        );
      }
      const request = parsedRequest.data;
      const adapter = resolvedDependencies.explanationAdapter;
      if (!adapter) {
        return context.json(
          createError(
            "provider-unavailable",
            "Word understanding is not set up on this gateway yet.",
            request.requestId,
            false,
          ),
          503,
        );
      }
      try {
        const result = await runWithProviderDeadline(
          (signal) => adapter.understandWord(request, signal),
          context.req.raw.signal,
          resolvedDependencies.explanationTimeoutMilliseconds,
        );
        const parsedResult = wordUnderstandingResultSchema.safeParse(result);
        if (!parsedResult.success) {
          return context.json(
            createError(
              "provider-unavailable",
              "The word-understanding provider returned an unusable response.",
              request.requestId,
              true,
            ),
            502,
          );
        }
        return context.json(parsedResult.data);
      } catch (error) {
        return providerFailure(context, error, request.requestId, "word understanding");
      }
    },
  );

  // Explaining is a second deliberate click on a result the reader already has. It carries its
  // own provider consent and never stores the text.
  app.post(
    GATEWAY_ROUTES.explain,
    bodyLimit({
      maxSize: MAX_GATEWAY_REQUEST_BYTES,
      onError: (context) =>
        invalidRequest(context, "The explanation request body is too large.", 413),
    }),
    async (context) => {
      const accepted = await acceptJsonPost(context, resolvedDependencies);
      if (!accepted.ok) return accepted.response;

      const parsedRequest = explanationRequestSchema.safeParse(accepted.payload);
      if (!parsedRequest.success) {
        return context.json(
          createError(
            "invalid-request",
            "The explanation request did not match the supported contract.",
            safeRequestId(accepted.payload),
            false,
          ),
          400,
        );
      }
      const request = parsedRequest.data;

      const adapter = resolvedDependencies.explanationAdapter;
      if (!adapter) {
        return context.json(
          createError(
            "provider-unavailable",
            "Explanations are not set up on this gateway yet.",
            request.requestId,
            false,
          ),
          503,
        );
      }

      try {
        const result = await runWithProviderDeadline(
          (signal) => adapter.explain(request, signal),
          context.req.raw.signal,
          resolvedDependencies.explanationTimeoutMilliseconds,
        );
        const parsedResult = explanationResultSchema.safeParse(result);
        if (!parsedResult.success) {
          return context.json(
            createError(
              "provider-unavailable",
              "The explanation provider returned an unusable response.",
              request.requestId,
              true,
            ),
            502,
          );
        }
        return context.json(parsedResult.data);
      } catch (error) {
        return providerFailure(context, error, request.requestId, "explanation");
      }
    },
  );

  return app;
}
