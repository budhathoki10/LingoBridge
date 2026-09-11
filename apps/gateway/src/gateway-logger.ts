import type { MiddlewareHandler } from "hono";

export interface GatewayRequestLog {
  durationMilliseconds: number;
  event: "gateway.request";
  method: string;
  path: string;
  requestId: string;
  status: number;
}

export interface GatewayLogger {
  info(event: GatewayRequestLog): void;
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
