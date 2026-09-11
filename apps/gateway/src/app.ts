import {
  ANONYMOUS_INSTALLATION_HEADER,
  anonymousInstallationIdSchema,
  type CapabilityCatalogue,
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
} from "@lingobridge/contracts";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { fakeCapabilityCatalogue, supportsTranslation } from "./capabilities.js";
import { FakeTranslationAdapter } from "./fake-translation-adapter.js";
import {
  consoleGatewayLogger,
  type GatewayLogger,
  requestAuditMiddleware,
} from "./gateway-logger.js";
import { ProviderInterruptedError, runWithProviderDeadline } from "./provider-deadline.js";
import { MemoryRateLimiter, type RateLimiter } from "./rate-limiter.js";
import { developmentSecurityConfig, type GatewaySecurityConfig } from "./security.js";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

export interface GatewayDependencies {
  capabilityProvider: {
    get(signal: AbortSignal): Promise<CapabilityCatalogue>;
  };
  getClientAddress: (context: Context) => string;
  logger: GatewayLogger;
  rateLimiter: RateLimiter;
  security: GatewaySecurityConfig;
  serviceVersion: string;
  translationAdapter: TranslationAdapter;
  translationMode: "fake" | "live";
}

const defaultDependencies: GatewayDependencies = {
  capabilityProvider: { get: async () => fakeCapabilityCatalogue },
  getClientAddress: () => "unknown-network",
  logger: consoleGatewayLogger,
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
      if (!context.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
        return invalidRequest(context, "Expected an application/json request body.", 415);
      }

      const installationId = anonymousInstallationIdSchema.safeParse(
        context.req.header(ANONYMOUS_INSTALLATION_HEADER),
      );
      if (!installationId.success) {
        return invalidRequest(
          context,
          "A valid anonymous installation identifier is required.",
          400,
        );
      }

      const rateLimitResponse = checkRateLimit(context, resolvedDependencies, installationId.data);
      if (rateLimitResponse) return rateLimitResponse;

      let payload: unknown;
      try {
        payload = await context.req.json();
      } catch {
        return context.json(
          createError("invalid-request", "Expected a valid JSON request body.", null, false),
          400,
        );
      }

      const parsedRequest = translationRequestSchema.safeParse(payload);
      if (!parsedRequest.success) {
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
        if (error instanceof ProviderInterruptedError) {
          if (error.reason === "timeout") {
            return context.json(
              createError(
                "timeout",
                "The translation provider took too long to respond.",
                request.requestId,
                true,
              ),
              504,
            );
          }
          return context.json(
            createError(
              "cancelled",
              "The translation request was cancelled.",
              request.requestId,
              true,
            ),
            408,
          );
        }

        if (error instanceof TranslationAdapterError) {
          return context.json(
            createError(
              error.code,
              error.code === "timeout"
                ? "The translation provider took too long to respond."
                : "The translation provider is temporarily unavailable.",
              request.requestId,
              error.retryable,
            ),
            error.code === "timeout" ? 504 : 503,
          );
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return context.json(
            createError(
              "cancelled",
              "The translation request was cancelled.",
              request.requestId,
              true,
            ),
            408,
          );
        }

        return context.json(
          createError(
            "internal-error",
            "The gateway could not complete the translation.",
            request.requestId,
            true,
          ),
          500,
        );
      }
    },
  );

  return app;
}
