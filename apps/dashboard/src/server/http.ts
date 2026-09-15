import {
  type AccountApiErrorCode,
  accountApiErrorSchema,
  MAX_ACCOUNT_API_REQUEST_BYTES,
} from "@lingobridge/contracts/account";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(BASE_HEADERS)) headers.set(name, value);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

const STATUS_BY_CODE: Record<AccountApiErrorCode, number> = {
  conflict: 409,
  forbidden: 403,
  "internal-error": 500,
  "invalid-grant": 400,
  "invalid-request": 400,
  "not-found": 404,
  "rate-limited": 429,
  "session-expired": 401,
  "session-revoked": 401,
  unauthorized: 401,
};

export function errorResponse(
  code: AccountApiErrorCode,
  message: string,
  init: ResponseInit & { retryable?: boolean } = {},
): Response {
  return jsonResponse(
    accountApiErrorSchema.parse({ code, message, retryable: init.retryable ?? false }),
    { ...init, status: init.status ?? STATUS_BY_CODE[code] },
  );
}

export function redirectResponse(location: string, setCookies: readonly string[] = []): Response {
  const headers = new Headers({ ...BASE_HEADERS, Location: location });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { headers, status: 303 });
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads a bounded JSON body. The size limit is enforced while streaming, not after buffering. */
export async function readJsonBody(
  request: Request,
  maximumBytes = MAX_ACCOUNT_API_REQUEST_BYTES,
): Promise<BodyResult> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: errorResponse("invalid-request", "Expected an application/json request body.", {
        status: 415,
      }),
    };
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > maximumBytes) {
    return {
      ok: false,
      response: errorResponse("invalid-request", "The request body is too large.", { status: 413 }),
    };
  }
  const reader = request.body?.getReader();
  if (!reader)
    return { ok: false, response: errorResponse("invalid-request", "A body is required.") };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      return {
        ok: false,
        response: errorResponse("invalid-request", "The request body is too large.", {
          status: 413,
        }),
      };
    }
    chunks.push(value);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse("invalid-request", "Expected valid JSON.") };
  }
}

/**
 * Cookie-authenticated mutations must come from the dashboard's own pages. The Origin header is
 * required and must match exactly; Sec-Fetch-Site, when the browser sends it, must be same-origin.
 */
export function isSameOriginRequest(request: Request, dashboardOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== dashboardOrigin) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  return site === null || site === "same-origin";
}
