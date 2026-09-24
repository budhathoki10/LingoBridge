import {
  AUTH_POLICY,
  beginSignIn,
  completeSignIn,
  resolveWebSession,
  signOut,
  verifySessionCsrf,
} from "@lingobridge/auth";
import { clearCookie, cookieNames, readCookie, serializeCookie } from "../cookies";
import { isSameOriginRequest, redirectResponse } from "../http";
import { networkKey, RATE_LIMITS } from "../rate-limit";
import type { DashboardServices } from "../services";

function signInError(services: DashboardServices, reason: string, extraCookies: string[] = []) {
  return redirectResponse(
    `${services.config.origin}/sign-in?error=${encodeURIComponent(reason)}`,
    extraCookies,
  );
}

/**
 * GET /auth/sign-in?returnTo=/phrases — starts the authorization code flow with PKCE.
 * `prompt=select_account` shows the provider's account chooser, so a signed-in person can switch
 * accounts; the previous session ends only once the new sign-in completes.
 */
export async function handleSignInStart(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const limit = services.rateLimiter.consume("sign-in", networkKey(request), RATE_LIMITS.signIn);
  if (!limit.allowed) return signInError(services, "rate-limited");

  const url = new URL(request.url);
  try {
    const start = await beginSignIn(services.webAuth, {
      chooseAccount: url.searchParams.get("prompt") === "select_account",
      purpose: "sign-in",
      returnTo: url.searchParams.get("returnTo"),
    });
    const names = cookieNames(services.config.secureCookies);
    return redirectResponse(start.authorizationUrl, [
      serializeCookie(names.loginBinding, start.browserBinding, {
        maxAgeSeconds: AUTH_POLICY.loginAttemptMilliseconds / 1_000,
        secure: services.config.secureCookies,
      }),
    ]);
  } catch {
    return signInError(services, "provider-unavailable");
  }
}

/** GET /auth/reauthenticate?returnTo=/privacy — asks the provider for a fresh sign-in. */
export async function handleReauthenticateStart(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const names = cookieNames(services.config.secureCookies);
  const sessionToken = readCookie(request.headers.get("Cookie"), names.session);
  const auth = await resolveWebSession(services.webAuth, sessionToken);
  const url = new URL(request.url);
  if (!auth) {
    return redirectResponse(
      `${services.config.origin}/sign-in?returnTo=${encodeURIComponent(url.searchParams.get("returnTo") ?? "/privacy")}`,
    );
  }
  try {
    const start = await beginSignIn(services.webAuth, {
      purpose: "reauthenticate",
      returnTo: url.searchParams.get("returnTo"),
      userId: auth.user.id,
    });
    return redirectResponse(start.authorizationUrl, [
      serializeCookie(names.loginBinding, start.browserBinding, {
        maxAgeSeconds: AUTH_POLICY.loginAttemptMilliseconds / 1_000,
        secure: services.config.secureCookies,
      }),
    ]);
  } catch {
    return redirectResponse(`${services.config.origin}/privacy?reauth=failed`);
  }
}

/** GET /auth/callback — validates state, browser binding, code, PKCE, and the ID token. */
export async function handleCallback(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const url = new URL(request.url);
  const names = cookieNames(services.config.secureCookies);
  const cookieHeader = request.headers.get("Cookie");
  const clearBinding = clearCookie(names.loginBinding, services.config.secureCookies);

  const result = await completeSignIn(services.webAuth, {
    browserBinding: readCookie(cookieHeader, names.loginBinding),
    code: url.searchParams.get("code"),
    currentSessionToken: readCookie(cookieHeader, names.session),
    providerError: url.searchParams.get("error"),
    state: url.searchParams.get("state"),
  });

  if (result.kind === "failed") {
    if (result.reason === "account-mismatch") {
      return redirectResponse(`${services.config.origin}/privacy?reauth=mismatch`, [clearBinding]);
    }
    return signInError(services, result.reason, [clearBinding]);
  }
  if (result.kind === "reauthenticated") {
    return redirectResponse(`${services.config.origin}${result.returnTo}`, [clearBinding]);
  }
  const maxAgeSeconds = (result.sessionExpiresAt.getTime() - services.now().getTime()) / 1_000;
  return redirectResponse(`${services.config.origin}${result.returnTo}`, [
    clearBinding,
    serializeCookie(names.session, result.sessionToken, {
      maxAgeSeconds,
      secure: services.config.secureCookies,
    }),
  ]);
}

/** POST /auth/sign-out — a form post carrying the session's CSRF token. */
export async function handleSignOut(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const names = cookieNames(services.config.secureCookies);
  const sessionToken = readCookie(request.headers.get("Cookie"), names.session);
  if (!isSameOriginRequest(request, services.config.origin)) {
    return new Response("Forbidden", { status: 403 });
  }
  const form = new URLSearchParams(await request.text().catch(() => ""));
  if (sessionToken && !verifySessionCsrf(services.webAuth, sessionToken, form.get("csrf"))) {
    return new Response("Forbidden", { status: 403 });
  }
  await signOut(services.webAuth, sessionToken);
  return redirectResponse(`${services.config.origin}/sign-in?signedOut=1`, [
    clearCookie(names.session, services.config.secureCookies),
  ]);
}
