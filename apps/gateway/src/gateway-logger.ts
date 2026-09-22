import type { MiddlewareHandler } from "hono";

export interface GatewayRequestLog {
  durationMilliseconds: number;
  event: "gateway.request";
  method: string;
  path: string;
  requestId: string;
  status: number;
}

/**
 * Why a provider call failed, in the provider's own status terms. It carries no translated text,
 * so it stays inside the privacy boundary while making an outage diagnosable from the logs.
 */
export interface GatewayProviderLog {
  detail: string | null;
  event: "gateway.provider";
  httpStatus: number | null;
  outcome: string;
  provider: "mymemory";
  quotaFinished: boolean | null;
  responseStatus: number | string | null;
  retryAfterSeconds: number | null;
}

export interface GatewayLogger {
  info(event: GatewayRequestLog): void;
}

/**
 * Provider failures are operator diagnostics rather than request audit, so they bypass the
 * request logger and go straight to the console in the same one-line JSON shape.
 */
export function logProviderFailure(event: Omit<GatewayProviderLog, "event">): void {
  console.info(JSON.stringify({ ...event, event: "gateway.provider" }));
}

export const consoleGatewayLogger: GatewayLogger = {
  info(event) {
    console.info(JSON.stringify(event));
  },
};

export function requestAuditMiddleware(
  logger: GatewayLogger,
  now: () => number = Date.now,
): MiddlewareHandler {
  return async (context, next) => {
    const startedAt = now();
    const requestId = crypto.randomUUID();
    context.header("X-Request-Id", requestId);

    try {
      await next();
    } finally {
      logger.info({
        durationMilliseconds: Math.max(0, now() - startedAt),
        event: "gateway.request",
        method: context.req.method,
        path: context.req.path,
        requestId,
        status: context.res.status,
      });
    }
  };
}
