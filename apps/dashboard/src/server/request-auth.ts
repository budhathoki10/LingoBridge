import {
  type AuthenticatedWebSession,
  resolveWebSession,
  verifySessionCsrf,
} from "@lingobridge/auth";
import { cookieNames, readCookie } from "./cookies";
import { errorResponse, isSameOriginRequest } from "./http";
import { RATE_LIMITS } from "./rate-limit";
import type { DashboardServices } from "./services";

export const CSRF_HEADER = "X-CSRF-Token";

export type DashboardRequestAuth =
  | { auth: AuthenticatedWebSession; ok: true; sessionToken: string }
  | { ok: false; response: Response };

/**
 * Identity is derived from the session cookie on every request. Mutations additionally require an
 * exact same-origin request and a CSRF token bound to that session. Client-supplied user ids are
 * never read.
 */
export async function authenticateDashboardRequest(
  request: Request,
  services: DashboardServices,
  options: { csrfToken?: string | null; mutation: boolean },
): Promise<DashboardRequestAuth> {
  const names = cookieNames(services.config.secureCookies);
  const sessionToken = readCookie(request.headers.get("Cookie"), names.session);

  if (options.mutation && !isSameOriginRequest(request, services.config.origin)) {
    return {
      ok: false,
      response: errorResponse("forbidden", "The request did not come from the dashboard."),
    };
  }

  const auth = sessionToken ? await resolveWebSession(services.webAuth, sessionToken) : null;
  if (!auth || !sessionToken) {
    return { ok: false, response: errorResponse("unauthorized", "Sign in to continue.") };
  }

  if (options.mutation) {
    const presented = options.csrfToken ?? request.headers.get(CSRF_HEADER);
    if (!verifySessionCsrf(services.webAuth, sessionToken, presented)) {
      return {
        ok: false,
        response: errorResponse("forbidden", "The request could not be verified. Reload the page."),
      };
    }
    const limit = services.rateLimiter.consume(
      "dashboard-mutation",
      auth.user.id,
      RATE_LIMITS.dashboardMutation,
    );
    if (!limit.allowed) {
      return {
        ok: false,
        response: errorResponse("rate-limited", "Too many changes. Wait a moment and try again.", {
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
          retryable: true,
        }),
      };
    }
  }

  return { auth, ok: true, sessionToken };
}
