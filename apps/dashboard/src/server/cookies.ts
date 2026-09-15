/**
 * Cookie handling for the two browser credentials the dashboard issues. Over HTTPS both use the
 * `__Host-` prefix, which forces Secure, Path=/, and no Domain, so a sibling subdomain can never
 * set or read them. Both are HttpOnly: no dashboard script ever needs to see them.
 */

export interface CookieNames {
  loginBinding: string;
  session: string;
}

export function cookieNames(secure: boolean): CookieNames {
  return secure
    ? { loginBinding: "__Host-lingobridge_login", session: "__Host-lingobridge_session" }
    : { loginBinding: "lingobridge_login", session: "lingobridge_session" };
}

/** A cookie-name-only check the edge proxy can use without touching the database. */
export const SESSION_COOKIE_CANDIDATES = [
  "__Host-lingobridge_session",
  "lingobridge_session",
] as const;

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{16,128}$/u.test(value) ? value : null;
  }
  return null;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure: boolean },
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0, secure });
}
