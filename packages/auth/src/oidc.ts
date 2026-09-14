import type { VerifiedIdentity } from "@lingobridge/database";
import { createRemoteJWKSet, customFetch, type JWTVerifyGetKey, jwtVerify } from "jose";
import { safeEqual } from "./crypto.js";

export type OidcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OidcClientConfig {
  clientId: string;
  /** Omit for a public client; the dashboard is a confidential client in production. */
  clientSecret: string | null;
  issuer: string;
  redirectUri: string;
  scopes: readonly string[];
}

export interface OidcDependencies {
  fetch?: OidcFetch;
  /** Injected in tests; production fetches the provider's published key set. */
  jwks?: JWTVerifyGetKey;
  now?: () => Date;
  timeoutMilliseconds?: number;
}

interface ProviderMetadata {
  authorization_endpoint: string;
  issuer: string;
  jwks_uri: string;
  token_endpoint: string;
}

export class OidcError extends Error {
  readonly reason:
    | "discovery-failed"
    | "token-exchange-failed"
    | "invalid-id-token"
    | "nonce-mismatch"
    | "authentication-too-old";

  constructor(reason: OidcError["reason"], message: string) {
    super(message);
    this.name = "OidcError";
    this.reason = reason;
  }
}

export interface VerifiedSignIn extends VerifiedIdentity {
  authenticatedAt: Date;
}

const ALLOWED_ALGORITHMS = ["RS256", "PS256", "ES256", "EdDSA"];
const CLOCK_TOLERANCE_SECONDS = 60;

function isHttpsOrLoopback(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

export class OidcClient {
  readonly config: OidcClientConfig;
  readonly #fetch: OidcFetch;
  readonly #injectedJwks: JWTVerifyGetKey | undefined;
  readonly #now: () => Date;
  readonly #timeout: number;
  #metadata: Promise<ProviderMetadata> | undefined;
  #jwks: JWTVerifyGetKey | undefined;

  constructor(config: OidcClientConfig, dependencies: OidcDependencies = {}) {
    if (!isHttpsOrLoopback(config.issuer)) {
      throw new Error("The OIDC issuer must use HTTPS outside loopback development.");
    }
    this.config = config;
    this.#fetch = dependencies.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#injectedJwks = dependencies.jwks;
    this.#now = dependencies.now ?? (() => new Date());
    this.#timeout = dependencies.timeoutMilliseconds ?? 10_000;
  }

  #metadataPromise(): Promise<ProviderMetadata> {
    this.#metadata ??= this.#discover().catch((error) => {
      this.#metadata = undefined;
      throw error;
    });
    return this.#metadata;
  }

  async #discover(): Promise<ProviderMetadata> {
    const url = `${this.config.issuer.replace(/\/$/u, "")}/.well-known/openid-configuration`;
    let payload: Partial<ProviderMetadata>;
    try {
      const response = await this.#fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.#timeout),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      payload = (await response.json()) as Partial<ProviderMetadata>;
    } catch {
      throw new OidcError("discovery-failed", "The identity provider could not be reached.");
    }
    if (
      payload.issuer !== this.config.issuer ||
      typeof payload.authorization_endpoint !== "string" ||
      typeof payload.token_endpoint !== "string" ||
      typeof payload.jwks_uri !== "string" ||
      ![payload.authorization_endpoint, payload.token_endpoint, payload.jwks_uri].every(
        isHttpsOrLoopback,
      )
    ) {
      throw new OidcError("discovery-failed", "The identity provider metadata is invalid.");
    }
    return payload as ProviderMetadata;
  }

  async authorizationUrl(input: {
    codeChallenge: string;
    maxAgeSeconds?: number;
    nonce: string;
    prompt?: "login";
    state: string;
  }): Promise<string> {
    const metadata = await this.#metadataPromise();
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", this.config.scopes.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (input.prompt) url.searchParams.set("prompt", input.prompt);
    if (input.maxAgeSeconds !== undefined) {
      url.searchParams.set("max_age", String(input.maxAgeSeconds));
    }
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string }): Promise<string> {
    const metadata = await this.#metadataPromise();
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
    });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);

    let payload: { id_token?: unknown };
    try {
      const response = await this.#fetch(metadata.token_endpoint, {
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#timeout),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      payload = (await response.json()) as { id_token?: unknown };
    } catch {
      throw new OidcError("token-exchange-failed", "The sign-in code could not be exchanged.");
    }
    if (typeof payload.id_token !== "string") {
      throw new OidcError("token-exchange-failed", "The identity provider returned no ID token.");
    }
    // Provider access and refresh tokens are deliberately discarded: the dashboard needs only the
    // verified identity, and LingoBridge issues its own sessions.
    return payload.id_token;
  }

  async #keySet(): Promise<JWTVerifyGetKey> {
    if (this.#injectedJwks) return this.#injectedJwks;
    if (!this.#jwks) {
      const metadata = await this.#metadataPromise();
      const fetcher = this.#fetch;
      this.#jwks = createRemoteJWKSet(new URL(metadata.jwks_uri), {
        [customFetch]: (url: string, options: RequestInit) => fetcher(url, options),
        timeoutDuration: this.#timeout,
      });
    }
    return this.#jwks;
  }

  async verifyIdToken(
    idToken: string,
    expected: { maxAgeSeconds?: number; nonce: string },
  ): Promise<VerifiedSignIn> {
    const now = this.#now();
    let claims: Record<string, unknown>;
    try {
      const result = await jwtVerify(idToken, await this.#keySet(), {
        algorithms: ALLOWED_ALGORITHMS,
        audience: this.config.clientId,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
        issuer: this.config.issuer,
        requiredClaims: ["sub", "iat", "exp"],
      });
      claims = result.payload as Record<string, unknown>;
    } catch {
      throw new OidcError("invalid-id-token", "The identity token could not be verified.");
    }

    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== this.config.clientId) {
      throw new OidcError("invalid-id-token", "The identity token was issued to another client.");
    }
    if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, expected.nonce)) {
      throw new OidcError("nonce-mismatch", "The identity token does not match this sign-in.");
    }
    if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 255) {
      throw new OidcError("invalid-id-token", "The identity token has no usable subject.");
    }

    const authTimeSeconds =
      typeof claims.auth_time === "number" ? claims.auth_time : (claims.iat as number);
    if (expected.maxAgeSeconds !== undefined) {
      if (typeof claims.auth_time !== "number") {
        throw new OidcError(
          "authentication-too-old",
          "The provider did not confirm a fresh sign-in.",
        );
      }
      const ageSeconds = now.getTime() / 1_000 - claims.auth_time;
      if (ageSeconds > expected.maxAgeSeconds + CLOCK_TOLERANCE_SECONDS) {
        throw new OidcError("authentication-too-old", "A fresh sign-in is required.");
      }
    }

    const email = typeof claims.email === "string" ? claims.email.slice(0, 320) : null;
    const name = typeof claims.name === "string" ? claims.name.slice(0, 120) : null;
    return {
      authenticatedAt: new Date(authTimeSeconds * 1_000),
      displayName: name,
      email,
      emailVerified: claims.email_verified === true,
      issuer: this.config.issuer,
      subject: claims.sub,
    };
  }
}
