import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bits of entropy, URL-safe. Used for session tokens, codes, state, nonce, and bindings. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Credentials are stored only as SHA-256 digests. They are high-entropy random values, so a fast
 * hash is sufficient and a database leak does not yield usable tokens.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/* PKCE, RFC 7636. Only S256 is accepted. */

const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/u;
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;

export function createCodeVerifier(): string {
  return randomToken(48);
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function isValidCodeChallenge(challenge: string): boolean {
  return CODE_CHALLENGE.test(challenge);
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!CODE_VERIFIER.test(verifier) || !isValidCodeChallenge(challenge)) return false;
  return safeEqual(createCodeChallenge(verifier), challenge);
}

/*
 * CSRF tokens are derived from the session token with a server secret, so they need no storage,
 * change whenever the session changes, and cannot be computed by a page that lacks the cookie.
 */

export function deriveCsrfToken(secret: string, sessionToken: string): string {
  return createHmac("sha256", secret).update(`csrf:${sessionToken}`, "utf8").digest("base64url");
}

export function verifyCsrfToken(
  secret: string,
  sessionToken: string,
  presented: string | null | undefined,
): boolean {
  if (!presented) return false;
  return safeEqual(deriveCsrfToken(secret, sessionToken), presented);
}
