import { randomBytes } from "node:crypto";

export type DashboardEnvironment = Readonly<Record<string, string | undefined>>;

export type AuthMode = "development" | "oidc";

export interface DashboardConfig {
  /** Admin role is granted at sign-in only to verified emails on this list. */
  adminEmails: ReadonlySet<string>;
  /** "*" accepts any unpacked extension id and is refused in production. */
  allowedExtensionIds: ReadonlySet<string> | "any";
  authMode: AuthMode;
  databaseName: string;
  /** A mongodb:// or mongodb+srv:// connection string. Never logged or sent to the browser. */
  databaseUrl: string | null;
  embeddedDatabaseDirectory: string | null;
  gatewayUrl: string;
  oidc: { clientId: string; clientSecret: string | null; issuer: string; providerName: string };
  operationsMetricsToken: string | null;
  /** Exact origin the dashboard is served from, e.g. https://dashboard.lingobridge.app */
  origin: string;
  production: boolean;
  secureCookies: boolean;
  sessionSecret: string;
}

const EXTENSION_ID = /^[a-p]{32}$/u;
const DEVELOPMENT_GATEWAY_URL = "http://127.0.0.1:8787";
const PRODUCTION_GATEWAY_URL = "https://lingobridge-gateway-t9zx.onrender.com";

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readOrigin(value: string | undefined, production: boolean): string {
  const raw = value?.trim() || (production ? "" : "http://127.0.0.1:3000");
  if (!raw) throw new Error("LINGOBRIDGE_DASHBOARD_ORIGIN is required in production.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LINGOBRIDGE_DASHBOARD_ORIGIN must be an absolute origin.");
  }
  if (url.origin !== raw.replace(/\/$/u, "")) {
    throw new Error("LINGOBRIDGE_DASHBOARD_ORIGIN must be an origin without a path.");
  }
  if (production && url.protocol !== "https:") {
    throw new Error("LINGOBRIDGE_DASHBOARD_ORIGIN must use HTTPS in production.");
  }
  return url.origin;
}

/** The validated origin alone, for public routes that must not open the database. */
export function loadDashboardOrigin(environment: DashboardEnvironment): string {
  return readOrigin(environment.LINGOBRIDGE_DASHBOARD_ORIGIN, environment.NODE_ENV === "production");
}

/**
 * Configuration comes only from the environment. Production refuses every development shortcut:
 * the local identity provider, the embedded database, generated secrets, and a wildcard extension
 * allowlist.
 */
export function loadDashboardConfig(environment: DashboardEnvironment): DashboardConfig {
  const production = environment.NODE_ENV === "production";
  const origin = readOrigin(environment.LINGOBRIDGE_DASHBOARD_ORIGIN, production);

  const authMode = (environment.LINGOBRIDGE_AUTH_MODE ??
    (production ? "oidc" : "development")) as AuthMode;
  if (authMode !== "development" && authMode !== "oidc") {
    throw new Error("LINGOBRIDGE_AUTH_MODE must be development or oidc.");
  }
  if (production && authMode === "development") {
    throw new Error("The development identity provider cannot run in production.");
  }

  const oidcIssuer = environment.OIDC_ISSUER?.trim() || "https://accounts.google.com";
  const oidcClientId = environment.OIDC_CLIENT_ID?.trim() ?? "";
  const oidcClientSecret = environment.OIDC_CLIENT_SECRET?.trim() || null;
  if (authMode === "oidc" && !oidcClientId) {
    throw new Error("OIDC mode requires OIDC_CLIENT_ID.");
  }
  if (production && !oidcClientSecret) {
    throw new Error("OIDC_CLIENT_SECRET is required for production dashboard sign-in.");
  }

  let sessionSecret = environment.LINGOBRIDGE_SESSION_SECRET?.trim() ?? "";
  if (!sessionSecret) {
    if (production) throw new Error("LINGOBRIDGE_SESSION_SECRET is required in production.");
    sessionSecret = randomBytes(32).toString("base64url");
  }
  if (sessionSecret.length < 32) {
    throw new Error("LINGOBRIDGE_SESSION_SECRET must be at least 32 characters.");
  }

  const extensionIds = list(environment.LINGOBRIDGE_ALLOWED_EXTENSION_IDS);
  let allowedExtensionIds: DashboardConfig["allowedExtensionIds"];
  if (extensionIds.length === 1 && extensionIds[0] === "*") {
    if (production) throw new Error("A wildcard extension allowlist cannot be used in production.");
    allowedExtensionIds = "any";
  } else if (extensionIds.length === 0) {
    if (production) {
      throw new Error("LINGOBRIDGE_ALLOWED_EXTENSION_IDS is required in production.");
    }
    allowedExtensionIds = "any";
  } else {
    if (extensionIds.some((id) => !EXTENSION_ID.test(id))) {
      throw new Error("LINGOBRIDGE_ALLOWED_EXTENSION_IDS must contain 32-character extension ids.");
    }
    allowedExtensionIds = new Set(extensionIds);
  }

  const databaseUrl = environment.DATABASE_URL?.trim() || null;
  if (production && !databaseUrl) throw new Error("DATABASE_URL is required in production.");
  if (databaseUrl && !/^mongodb(\+srv)?:\/\//u.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a mongodb:// or mongodb+srv:// connection string.");
  }
  const databaseName = environment.DATABASE_NAME?.trim() || "lingobridge";
  if (!/^[A-Za-z0-9_-]{1,63}$/u.test(databaseName)) {
    throw new Error("DATABASE_NAME may contain only letters, digits, underscores, and hyphens.");
  }

  const metricsToken = environment.LINGOBRIDGE_OPERATIONS_METRICS_TOKEN?.trim() || null;
  if (metricsToken && metricsToken.length < 32) {
    throw new Error("LINGOBRIDGE_OPERATIONS_METRICS_TOKEN must be at least 32 characters.");
  }

  return {
    adminEmails: new Set(
      list(environment.LINGOBRIDGE_ADMIN_EMAILS).map((email) => email.toLowerCase()),
    ),
    allowedExtensionIds,
    authMode,
    databaseName,
    databaseUrl,
    // "memory" keeps the development database in memory, for automated browser tests.
    embeddedDatabaseDirectory:
      databaseUrl || environment.LINGOBRIDGE_EMBEDDED_DATABASE_DIR?.trim() === "memory"
        ? null
        : environment.LINGOBRIDGE_EMBEDDED_DATABASE_DIR?.trim() || ".data/mongodb",
    gatewayUrl: (
      environment.LINGOBRIDGE_GATEWAY_URL?.trim() ||
      (production ? PRODUCTION_GATEWAY_URL : DEVELOPMENT_GATEWAY_URL)
    ).replace(/\/$/u, ""),
    oidc:
      authMode === "oidc"
        ? {
            clientId: oidcClientId,
            clientSecret: oidcClientSecret,
            issuer: oidcIssuer,
            providerName:
              environment.OIDC_PROVIDER_NAME?.trim() ||
              (oidcIssuer === "https://accounts.google.com" ? "Google" : "your identity provider"),
          }
        : {
            clientId: "lingobridge-dashboard-development",
            clientSecret: null,
            issuer: `${origin}/dev-identity`,
            providerName: "development sign-in",
          },
    operationsMetricsToken: metricsToken,
    origin,
    production,
    secureCookies: origin.startsWith("https://"),
    sessionSecret,
  };
}

export function oidcRedirectUri(config: Pick<DashboardConfig, "origin">): string {
  return `${config.origin}/auth/callback`;
}
