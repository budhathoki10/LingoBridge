import type { RateLimitRule } from "./rate-limiter.js";

const extensionOriginPattern = /^chrome-extension:\/\/[a-p]{32}$/u;

export interface OriginPolicy {
  allows(origin: string | undefined): boolean;
  corsOrigin(origin: string): string | undefined;
}

export interface GatewaySecurityConfig {
  installationRateLimit: RateLimitRule;
  networkRateLimit: RateLimitRule;
  originPolicy: OriginPolicy;
  providerTimeoutMilliseconds: number;
  requireOrigin: boolean;
}

export function createOriginPolicy(
  allowedOrigins: readonly string[],
  allowAnyExtensionOrigin = false,
): OriginPolicy {
  const normalizedOrigins = new Set(allowedOrigins.map((origin) => origin.replace(/\/$/u, "")));

  return {
    allows(origin) {
      if (!origin) return false;
      const normalizedOrigin = origin.replace(/\/$/u, "");
      return (
        normalizedOrigins.has(normalizedOrigin) ||
        (allowAnyExtensionOrigin && extensionOriginPattern.test(normalizedOrigin))
      );
    },
    corsOrigin(origin) {
      return this.allows(origin) ? origin.replace(/\/$/u, "") : undefined;
    },
  };
}

export function isExactExtensionOrigin(origin: string): boolean {
  return extensionOriginPattern.test(origin.replace(/\/$/u, ""));
}

export const developmentSecurityConfig: GatewaySecurityConfig = {
  installationRateLimit: { limit: 20, windowMilliseconds: 60_000 },
  networkRateLimit: { limit: 30, windowMilliseconds: 60_000 },
  originPolicy: createOriginPolicy([], true),
  providerTimeoutMilliseconds: 10_000,
  requireOrigin: false,
};
