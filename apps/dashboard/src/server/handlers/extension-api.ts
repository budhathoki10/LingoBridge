import {
  approveExtensionConnection,
  authenticateExtensionBearer,
  type BearerAuthentication,
  exchangeExtensionToken,
  parseConnectionRequest,
  resolveWebSession,
  revokeOwnExtensionSession,
  verifySessionCsrf,
} from "@lingobridge/auth";
import {
  extensionTokenRequestSchema,
  syncRequestSchema,
  syncResponseSchema,
  vocabularyUpsertRequestSchema,
  vocabularyUpsertResponseSchema,
} from "@lingobridge/contracts/account";
import { AccountUnavailableError, runSync, upsertSavedWord } from "@lingobridge/database";
import { cookieNames, readCookie } from "../cookies";
import {
  errorResponse,
  isSameOriginRequest,
  jsonResponse,
  readJsonBody,
  redirectResponse,
} from "../http";
import { networkKey, RATE_LIMITS } from "../rate-limit";
import type { DashboardServices } from "../services";

/**
 * Browsers attach an Origin to cross-origin requests. The extension's service worker sends its own
 * chrome-extension origin; a webpage would send its own site. Only allowlisted extensions pass.
 */
function extensionOriginAllowed(request: Request, services: DashboardServices): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  const match = /^chrome-extension:\/\/([a-p]{32})$/u.exec(origin);
  return Boolean(match?.[1] && services.extensionAuth.allowedExtensionIds.has(match[1]));
}

function bearerFailure(result: Exclude<BearerAuthentication, { kind: "active" }>): Response {
  if (result.kind === "expired") {
    return errorResponse("session-expired", "The access token expired. Refresh and retry.", {
      retryable: true,
    });
  }
  if (result.kind === "revoked") {
    return errorResponse("session-revoked", "This extension was disconnected from the account.");
  }
  return errorResponse("unauthorized", "A valid extension access token is required.");
}

/** POST /api/v1/extension/token — authorization_code (with PKCE) or refresh_token grants. */
export async function handleExtensionToken(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  if (!extensionOriginAllowed(request, services)) {
    return errorResponse("forbidden", "This origin cannot connect to LingoBridge.");
  }
  const limit = services.rateLimiter.consume(
    "extension-token",
    networkKey(request),
    RATE_LIMITS.extensionToken,
  );
  if (!limit.allowed) {
    return errorResponse("rate-limited", "Too many connection attempts. Try again shortly.", {
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
      retryable: true,
    });
  }
  const body = await readJsonBody(request, 4_096);
  if (!body.ok) return body.response;
  const parsed = extensionTokenRequestSchema.safeParse(body.value);
  if (!parsed.success) return errorResponse("invalid-request", "The token request is not valid.");

  const result = await exchangeExtensionToken(services.extensionAuth, parsed.data);
  if (!result.ok) {
    return result.error === "session-revoked"
      ? errorResponse("session-revoked", "This extension was disconnected from the account.")
      : errorResponse("invalid-grant", "The code or refresh token is invalid or expired.");
  }
  return jsonResponse(result.response);
}

/** POST /api/v1/extension/revoke — the extension disconnects itself. */
export async function handleExtensionRevoke(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  if (!extensionOriginAllowed(request, services)) {
    return errorResponse("forbidden", "This origin cannot use the LingoBridge API.");
  }
  const auth = await authenticateExtensionBearer(
    services.extensionAuth,
    request.headers.get("Authorization"),
  );
  if (auth.kind !== "active") {
    // Disconnecting an already-disconnected session is a success from the extension's view.
    return auth.kind === "unauthorized" ? bearerFailure(auth) : new Response(null, { status: 204 });
  }
  await revokeOwnExtensionSession(services.extensionAuth, auth.session);
  return new Response(null, { status: 204 });
}

/** POST /api/v1/sync — pushes queued mutations and pulls changes after the cursor. */
export async function handleSync(request: Request, services: DashboardServices): Promise<Response> {
  if (!extensionOriginAllowed(request, services)) {
    return errorResponse("forbidden", "This origin cannot use the LingoBridge API.");
  }
  const auth = await authenticateExtensionBearer(
    services.extensionAuth,
    request.headers.get("Authorization"),
  );
  if (auth.kind !== "active") return bearerFailure(auth);

  const limit = services.rateLimiter.consume("sync", auth.session.id, RATE_LIMITS.sync);
  if (!limit.allowed) {
    return errorResponse("rate-limited", "Syncing too often. It will retry automatically.", {
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
      retryable: true,
    });
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = syncRequestSchema.safeParse(body.value);
  if (!parsed.success) return errorResponse("invalid-request", "The sync request is not valid.");

  try {
    const response = await runSync(services.database, auth.user.id, parsed.data, services.now());
    return jsonResponse(syncResponseSchema.parse(response));
  } catch (error) {
    if (error instanceof AccountUnavailableError) {
      return errorResponse("session-revoked", "This account is no longer available.");
    }
    return errorResponse("internal-error", "Sync could not be completed. It will retry.", {
      retryable: true,
    });
  }
}

/** POST /api/v1/vocabulary — stores one word only after an explicit Save word action. */
export async function handleVocabularyUpsert(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  if (!extensionOriginAllowed(request, services)) {
    return errorResponse("forbidden", "This origin cannot use the LingoBridge API.");
  }
  const auth = await authenticateExtensionBearer(
    services.extensionAuth,
    request.headers.get("Authorization"),
  );
  if (auth.kind !== "active") return bearerFailure(auth);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = vocabularyUpsertRequestSchema.safeParse(body.value);
  if (!parsed.success) return errorResponse("invalid-request", "The saved word is not valid.");
  const word = await upsertSavedWord(services.database, auth.user.id, parsed.data.word);
  return jsonResponse(vocabularyUpsertResponseSchema.parse({ word }));
}

/**
 * POST /extension/connect/decision — the signed-in user approves or denies the connection shown on
 * /extension/connect. Approval issues a one-minute, single-use code bound to the PKCE challenge
 * and Chrome's redirect URL; the response redirects back to the extension.
 */
export async function handleConnectDecision(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  if (!isSameOriginRequest(request, services.config.origin)) {
    return new Response("Forbidden", { status: 403 });
  }
  const names = cookieNames(services.config.secureCookies);
  const sessionToken = readCookie(request.headers.get("Cookie"), names.session);
  const form = new URLSearchParams(await request.text().catch(() => ""));
  const auth = sessionToken ? await resolveWebSession(services.webAuth, sessionToken) : null;
  if (
    !auth ||
    !sessionToken ||
    !verifySessionCsrf(services.webAuth, sessionToken, form.get("csrf"))
  ) {
    return new Response("Your session could not be verified. Reload the page and try again.", {
      status: 403,
    });
  }

  const parsed = parseConnectionRequest(
    new URLSearchParams(form.get("request") ?? ""),
    services.extensionAuth.allowedExtensionIds,
  );
  if (!parsed.ok) return new Response("This connection request is not valid.", { status: 400 });

  if (form.get("decision") !== "approve") {
    const denied = new URL(parsed.request.redirectUri);
    denied.searchParams.set("error", "access_denied");
    denied.searchParams.set("state", parsed.request.state);
    return redirectResponse(denied.toString());
  }
  return redirectResponse(
    await approveExtensionConnection(services.extensionAuth, auth.user.id, parsed.request),
  );
}
