import {
  DevelopmentIdentityProvider,
  type ExtensionAuthDependencies,
  OidcClient,
  type OidcFetch,
  type WebAuthDependencies,
} from "@lingobridge/auth";
import { GATEWAY_ROUTES } from "@lingobridge/contracts";
import {
  OPERATIONS_METRICS_ROUTE,
  type OperationsMetrics,
  operationsMetricsSchema,
} from "@lingobridge/contracts/operations";
import { type Database, openDatabase } from "@lingobridge/database";
import { type DashboardConfig, oidcRedirectUri } from "./config";
import { MemoryRateLimiter } from "./rate-limit";

export type OperationsMetricsResult =
  | { gatewayHealthy: boolean; kind: "ok"; metrics: OperationsMetrics }
  | { kind: "disabled" }
  | { gatewayHealthy: boolean; kind: "unavailable" };

export interface DashboardServices {
  config: DashboardConfig;
  database: Database;
  developmentIdentity: DevelopmentIdentityProvider | null;
  extensionAuth: ExtensionAuthDependencies;
  fetchOperationsMetrics: () => Promise<OperationsMetricsResult>;
  now: () => Date;
  rateLimiter: MemoryRateLimiter;
  webAuth: WebAuthDependencies;
}

export interface ServiceOverrides {
  database?: Database;
  fetch?: OidcFetch;
  now?: () => Date;
}

function extensionAllowlist(
  config: DashboardConfig,
): ExtensionAuthDependencies["allowedExtensionIds"] {
  const allowed = config.allowedExtensionIds;
  return allowed === "any" ? { has: (id) => /^[a-p]{32}$/u.test(id) } : allowed;
}

export async function createDashboardServices(
  config: DashboardConfig,
  overrides: ServiceOverrides = {},
): Promise<DashboardServices> {
  const now = overrides.now ?? (() => new Date());
  const database =
    overrides.database ??
    (await openDatabase({
      connectionString: config.databaseUrl ?? undefined,
      databaseName: config.databaseName,
      embeddedDataDirectory: config.embeddedDatabaseDirectory ?? undefined,
      production: config.production,
    }));

  const developmentIdentity =
    config.authMode === "development"
      ? new DevelopmentIdentityProvider({
          clients: [{ clientId: config.oidc.clientId, redirectUri: oidcRedirectUri(config) }],
          issuer: config.oidc.issuer,
          now,
        })
      : null;

  const networkFetch: OidcFetch =
    overrides.fetch ?? ((input, init) => globalThis.fetch(input, init));
  // The development provider is served by this same process; route its calls in memory rather than
  // making the server request itself over HTTP.
  const oidcFetch: OidcFetch = developmentIdentity
    ? (input, init) => {
        const url = String(input);
        return url.startsWith(developmentIdentity.issuer)
          ? developmentIdentity.handle(new Request(url, init))
          : networkFetch(input, init);
      }
    : networkFetch;

  const oidc = new OidcClient(
    {
      clientId: config.oidc.clientId,
      clientSecret: config.oidc.clientSecret,
      issuer: config.oidc.issuer,
      redirectUri: oidcRedirectUri(config),
      scopes: ["openid", "email", "profile"],
    },
    { fetch: oidcFetch, now },
  );

  async function gatewayHealthy(): Promise<boolean> {
    try {
      const response = await networkFetch(`${config.gatewayUrl}${GATEWAY_ROUTES.health}`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    config,
    database,
    developmentIdentity,
    extensionAuth: { allowedExtensionIds: extensionAllowlist(config), database, now },
    async fetchOperationsMetrics() {
      if (!config.operationsMetricsToken) return { kind: "disabled" };
      const token = config.operationsMetricsToken;
      // Both calls go to the same gateway, so they run together rather than one after the other.
      const [healthy, metrics] = await Promise.all([
        gatewayHealthy(),
        (async () => {
          try {
            const response = await networkFetch(`${config.gatewayUrl}${OPERATIONS_METRICS_ROUTE}`, {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(4_000),
            });
            if (!response.ok) return null;
            const parsed = operationsMetricsSchema.safeParse(await response.json());
            return parsed.success ? parsed.data : null;
          } catch {
            return null;
          }
        })(),
      ]);
      return metrics
        ? { gatewayHealthy: healthy, kind: "ok", metrics }
        : { gatewayHealthy: healthy, kind: "unavailable" };
    },
    now,
    rateLimiter: new MemoryRateLimiter(() => now().getTime()),
    webAuth: {
      adminEmails: config.adminEmails,
      database,
      now,
      oidc,
      sessionSecret: config.sessionSecret,
    },
  };
}
