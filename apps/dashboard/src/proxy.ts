import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_CANDIDATES } from "./server/cookies";

export const PROTECTED_PREFIXES = [
  "/overview",
  "/phrases",
  "/vocabulary",
  "/preferences",
  "/extensions",
  "/privacy",
  "/admin",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function buildContentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Development tooling injects styles without a nonce; production styles are bundled files.
    development ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data:",
    "frame-src https://www.youtube-nocookie.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // The extension-connection approval redirects to Chrome's identity URL after the form post.
    "form-action 'self' https://*.chromiumapp.org",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Two jobs, both before rendering: attach a per-request CSP nonce, and send visitors without any
 * session cookie straight to sign-in. The proxy never trusts a cookie's presence as proof of a
 * session; protected layouts validate the session against the database on every render.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = SESSION_COOKIE_CANDIDATES.some((name) => request.cookies.has(name));

  if (isProtectedPath(pathname) && !hasSessionCookie) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.search = `?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(signIn, 303);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-lingobridge-path", `${pathname}${search}`);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|auth/|dev-identity/|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [{ key: "next-router-prefetch", type: "header" }],
    },
  ],
};
