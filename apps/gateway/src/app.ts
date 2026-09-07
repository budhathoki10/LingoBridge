import {
  GATEWAY_API_VERSION,
  GATEWAY_ROUTES,
  gatewayHealthSchema,
  gatewayVersionSchema,
  requestIdSchema,
  translationErrorSchema,
  translationRequestSchema,
  translationResultSchema,
  type CapabilityCatalogue,
  type TranslationError,
} from "@lingobridge/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { fakeCapabilityCatalogue, supportsFakeTranslation } from "./capabilities.js";
import { FakeTranslationAdapter } from "./fake-translation-adapter.js";
import { TranslationAdapterError, type TranslationAdapter } from "./translation-adapter.js";

export interface GatewayDependencies {
  capabilities: CapabilityCatalogue;
  translationAdapter: TranslationAdapter;
}

const defaultDependencies: GatewayDependencies = {
  capabilities: fakeCapabilityCatalogue,
  translationAdapter: new FakeTranslationAdapter(),
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

export function createGatewayApp(dependencies: Partial<GatewayDependencies> = {}): Hono {
  const resolvedDependencies = { ...defaultDependencies, ...dependencies };
  const app = new Hono();

  app.use(
    "/v1/*",
    cors({
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
      origin: (origin) => (origin.startsWith("chrome-extension://") ? origin : undefined),
    }),
  );

  app.get("/", (context) =>
    context.json({
      routes: GATEWAY_ROUTES,
      service: "lingobridge-gateway",
      status: "phase-3.1-fake-gateway",
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
        serviceVersion: "0.1.0",
        translationMode: "fake",
      }),
    ),
  );

  app.get(GATEWAY_ROUTES.capabilities, (context) =>
    context.json(resolvedDependencies.capabilities),
  );

  app.post(GATEWAY_ROUTES.translate, async (context) => {
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
    if (
      !supportsFakeTranslation(
        resolvedDependencies.capabilities,
        request.sourceLanguage,
        request.targetLanguage,
      )
    ) {
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
      const result = await resolvedDependencies.translationAdapter.translate(
        request,
        context.req.raw.signal,
      );
      return context.json(translationResultSchema.parse(result));
    } catch (error) {
      if (error instanceof TranslationAdapterError) {
        return context.json(
          createError(error.code, error.message, request.requestId, error.retryable),
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
  });

  return app;
}

export const app = createGatewayApp();
