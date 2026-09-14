import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { randomToken, verifyPkce } from "./crypto.js";

/**
 * A standards-conforming OpenID Connect issuer for local development and automated tests, playing
 * the role the fake translation adapter plays for providers. The dashboard's real OIDC client talks
 * to it exactly as it would to a hosted provider, so state, nonce, PKCE, signature, audience, and
 * expiry checks all run. It is refused in production by the dashboard configuration.
 */

interface IssuedCode {
  authTime: number;
  clientId: string;
  codeChallenge: string;
  email: string;
  expiresAt: number;
  name: string;
  nonce: string;
  redirectUri: string;
}

interface SigningMaterial {
  keyId: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

export interface DevelopmentIdentityProviderOptions {
  clients: readonly { clientId: string; redirectUri: string }[];
  /** Absolute URL of the issuer, e.g. http://127.0.0.1:3000/dev-identity */
  issuer: string;
  now?: () => Date;
}

const CODE_LIFETIME_MILLISECONDS = 60_000;
const ID_TOKEN_LIFETIME_SECONDS = 300;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    status,
  });
}

function tokenError(error: string, status = 400): Response {
  return json({ error }, status);
}

export class DevelopmentIdentityProvider {
  readonly issuer: string;
  readonly #clients: Map<string, string>;
  readonly #codes = new Map<string, IssuedCode>();
  readonly #now: () => Date;
  #signing: Promise<SigningMaterial> | undefined;

  constructor(options: DevelopmentIdentityProviderOptions) {
    this.issuer = options.issuer.replace(/\/$/u, "");
    this.#clients = new Map(options.clients.map((client) => [client.clientId, client.redirectUri]));
    this.#now = options.now ?? (() => new Date());
  }

  #signingMaterial(): Promise<SigningMaterial> {
    this.#signing ??= (async () => {
      const { privateKey, publicKey } = await generateKeyPair("RS256");
      const keyId = randomToken(8);
      const publicJwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: keyId, use: "sig" };
      return { keyId, privateKey, publicJwk };
    })();
    return this.#signing;
  }

  metadata() {
    return {
      authorization_endpoint: `${this.issuer}/authorize`,
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["RS256"],
      issuer: this.issuer,
      jwks_uri: `${this.issuer}/jwks`,
      response_types_supported: ["code"],
      scopes_supported: ["openid", "email", "profile"],
      subject_types_supported: ["public"],
      token_endpoint: `${this.issuer}/token`,
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    };
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: [(await this.#signingMaterial()).publicJwk] };
  }

  /** Validates an authorization request the way a hosted provider would before showing a form. */
  validateAuthorizationRequest(params: URLSearchParams): string | null {
    const clientId = params.get("client_id") ?? "";
    const redirectUri = this.#clients.get(clientId);
    if (!redirectUri) return "Unknown client.";
    if (params.get("redirect_uri") !== redirectUri) return "Redirect URI is not registered.";
    if (params.get("response_type") !== "code") return "Only the code flow is supported.";
    if (params.get("code_challenge_method") !== "S256") return "PKCE with S256 is required.";
    if (!/^[A-Za-z0-9_-]{43}$/u.test(params.get("code_challenge") ?? "")) {
      return "A valid code challenge is required.";
    }
    if (!params.get("state") || !params.get("nonce")) return "State and nonce are required.";
    return null;
  }

  /** Issues a code for a chosen development identity and returns the redirect location. */
  issueCode(params: URLSearchParams, identity: { email: string; name: string }): string {
    const problem = this.validateAuthorizationRequest(params);
    if (problem) throw new Error(problem);
    const code = randomToken();
    const now = this.#now().getTime();
    this.#codes.set(code, {
      authTime: Math.floor(now / 1_000),
      clientId: params.get("client_id") ?? "",
      codeChallenge: params.get("code_challenge") ?? "",
      email: identity.email,
      expiresAt: now + CODE_LIFETIME_MILLISECONDS,
      name: identity.name,
      nonce: params.get("nonce") ?? "",
      redirectUri: params.get("redirect_uri") ?? "",
    });
    const location = new URL(params.get("redirect_uri") ?? "");
    location.searchParams.set("code", code);
    location.searchParams.set("state", params.get("state") ?? "");
    return location.toString();
  }

  async exchange(body: URLSearchParams): Promise<Response> {
    if (body.get("grant_type") !== "authorization_code") {
      return tokenError("unsupported_grant_type");
    }
    const code = body.get("code") ?? "";
    const issued = this.#codes.get(code);
    this.#codes.delete(code);
    const now = this.#now().getTime();
    if (!issued || issued.expiresAt <= now) return tokenError("invalid_grant");
    if (issued.clientId !== body.get("client_id")) return tokenError("invalid_client", 401);
    if (issued.redirectUri !== body.get("redirect_uri")) return tokenError("invalid_grant");
    if (!verifyPkce(body.get("code_verifier") ?? "", issued.codeChallenge)) {
      return tokenError("invalid_grant");
    }

    const signing = await this.#signingMaterial();
    const email = issued.email.toLowerCase();
    const subject = createHash("sha256").update(email).digest("hex").slice(0, 32);
    const idToken = await new SignJWT({
      auth_time: issued.authTime,
      email,
      email_verified: true,
      name: issued.name,
      nonce: issued.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: signing.keyId, typ: "JWT" })
      .setIssuer(this.issuer)
      .setAudience(issued.clientId)
      .setSubject(`dev-${subject}`)
      .setIssuedAt(Math.floor(now / 1_000))
      .setExpirationTime(Math.floor(now / 1_000) + ID_TOKEN_LIFETIME_SECONDS)
      .sign(signing.privateKey);

    return json({ expires_in: ID_TOKEN_LIFETIME_SECONDS, id_token: idToken, token_type: "Bearer" });
  }

  /** Routes a request whose pathname is under the issuer path. */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const issuerPath = new URL(this.issuer).pathname.replace(/\/$/u, "");
    const path = url.pathname.slice(issuerPath.length);

    if (request.method === "GET" && path === "/.well-known/openid-configuration") {
      return json(this.metadata());
    }
    if (request.method === "GET" && path === "/jwks") return json(await this.jwks());
    if (request.method === "POST" && path === "/token") {
      return this.exchange(new URLSearchParams(await request.text()));
    }
    if (path === "/authorize" && request.method === "GET") {
      const problem = this.validateAuthorizationRequest(url.searchParams);
      if (problem) return new Response(problem, { status: 400 });
      return new Response(this.#authorizePage(url.searchParams), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
    if (path === "/authorize" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const email = (form.get("email") ?? "").trim();
      const name = (form.get("name") ?? "").trim() || email.split("@")[0] || "Developer";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 200) {
        return new Response("Enter a valid email address.", { status: 400 });
      }
      const params = new URLSearchParams(form.get("request") ?? "");
      try {
        return Response.redirect(this.issueCode(params, { email, name: name.slice(0, 80) }), 303);
      } catch (error) {
        return new Response(error instanceof Error ? error.message : "Invalid request.", {
          status: 400,
        });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  #authorizePage(params: URLSearchParams): string {
    const hint = escapeHtml(params.get("login_hint") ?? "");
    const request = escapeHtml(params.toString());
    const reauth = params.get("prompt") === "login";
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Development sign-in</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:Canvas;color:CanvasText}
main{width:100%;max-width:380px;border:1px solid color-mix(in srgb,CanvasText 14%,transparent);border-radius:12px;padding:28px}
p.badge{display:inline-block;margin:0 0 16px;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:color-mix(in srgb,#b45309 16%,transparent);color:#b45309}
h1{margin:0 0 6px;font-size:20px;letter-spacing:-.01em}
p{margin:0 0 20px;font-size:14px;line-height:1.5;opacity:.75}
label{display:block;margin:0 0 6px;font-size:13px;font-weight:600}
input{width:100%;box-sizing:border-box;height:40px;margin:0 0 14px;padding:0 12px;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:6px;font:inherit;font-size:16px;background:Canvas;color:CanvasText}
input:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
button{width:100%;height:40px;border:0;border-radius:6px;background:#2563eb;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#1d4ed8}button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
</style></head><body><main>
<p class="badge">Development identity provider</p>
<h1>${reauth ? "Confirm it’s you" : "Sign in"}</h1>
<p>Local testing only. No password is checked and nothing leaves this machine.</p>
<form method="post" action="authorize">
<input type="hidden" name="request" value="${request}">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" required autofocus value="${hint}">
<label for="name">Name</label>
<input id="name" name="name" type="text" autocomplete="name" maxlength="80">
<button type="submit">${reauth ? "Confirm" : "Continue"}</button>
</form></main></body></html>`;
  }
}
