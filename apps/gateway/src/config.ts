import {
  createOriginPolicy,
  developmentSecurityConfig,
  type GatewaySecurityConfig,
  isExactExtensionOrigin,
} from "./security.js";

export type TranslationMode = "fake" | "live";
export type GatewayEnvironment = Readonly<Record<string, string | undefined>>;

export interface GatewayRuntimeConfig {
  capabilityCachePath: string;
  capabilityFreshForMilliseconds: number;
  capabilityRetryAfterFailureMilliseconds: number;
  googleProjectId: string | null;
  hostname: string;
  nvidiaApiKey: string | null;
  nvidiaBaseUrl: string;
  nvidiaMaxTokens: number;
  nvidiaModel: string;
  port: number;
  security: GatewaySecurityConfig;
  serviceVersion: string;
  translationMode: TranslationMode;
}

function readGoogleProjectId(environment: GatewayEnvironment): string | null {
  const projectId = environment.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) return null;
  if (!/^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,20})$/u.test(projectId)) {
    throw new Error("GOOGLE_CLOUD_PROJECT must be a valid project ID or project number.");
  }
  return projectId;
}

function readNvidiaApiKey(environment: GatewayEnvironment): string | null {
  const apiKey = environment.NVIDIA_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

function readPositiveInteger(
  environment: GatewayEnvironment,
  name: string,
  fallback: number,
): number {
  const rawValue = environment[name];
  if (rawValue === undefined) return fallback;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readAllowedOrigins(environment: GatewayEnvironment): string[] {
  const origins = (environment.LINGOBRIDGE_ALLOWED_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/u, ""))
    .filter(Boolean);

  if (origins.some((origin) => !isExactExtensionOrigin(origin))) {
    throw new Error(
      "LINGOBRIDGE_ALLOWED_EXTENSION_ORIGINS must contain exact chrome-extension origins.",
    );
  }

  return [...new Set(origins)];
}

export function loadGatewayRuntimeConfig(environment: GatewayEnvironment): GatewayRuntimeConfig {
  const translationMode = environment.LINGOBRIDGE_TRANSLATION_MODE ?? "fake";
  if (translationMode !== "fake" && translationMode !== "live") {
    throw new Error("LINGOBRIDGE_TRANSLATION_MODE must be fake or live.");
  }

  const allowedOrigins = readAllowedOrigins(environment);
  if (translationMode === "live" && allowedOrigins.length === 0) {
    throw new Error("Live mode requires at least one exact extension origin.");
  }
  const googleProjectId = readGoogleProjectId(environment);
  const nvidiaApiKey = readNvidiaApiKey(environment);
  if (translationMode === "live" && !nvidiaApiKey) {
    throw new Error("Live mode requires NVIDIA_API_KEY.");
  }

  return {
    capabilityCachePath:
      environment.LINGOBRIDGE_CAPABILITY_CACHE_PATH ?? ".data/online-provider-capabilities.json",
    capabilityFreshForMilliseconds: readPositiveInteger(
      environment,
      "LINGOBRIDGE_CAPABILITY_FRESH_MS",
      24 * 60 * 60 * 1_000,
    ),
    capabilityRetryAfterFailureMilliseconds: readPositiveInteger(
      environment,
      "LINGOBRIDGE_CAPABILITY_RETRY_MS",
      5 * 60 * 1_000,
    ),
    googleProjectId: translationMode === "live" ? googleProjectId : null,
    hostname: environment.HOST ?? "127.0.0.1",
    nvidiaApiKey: translationMode === "live" ? nvidiaApiKey : null,
    nvidiaBaseUrl: environment.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    nvidiaMaxTokens: readPositiveInteger(environment, "NVIDIA_MAX_TOKENS", 2_048),
    nvidiaModel: environment.NVIDIA_MODEL ?? "nvidia/riva-translate-4b-instruct-v2",
    port: readPositiveInteger(environment, "PORT", 8_787),
    security: {
      installationRateLimit: {
        limit: readPositiveInteger(environment, "LINGOBRIDGE_INSTALLATION_RATE_LIMIT", 20),
        windowMilliseconds: readPositiveInteger(environment, "LINGOBRIDGE_RATE_WINDOW_MS", 60_000),
      },
      networkRateLimit: {
        limit: readPositiveInteger(environment, "LINGOBRIDGE_NETWORK_RATE_LIMIT", 30),
        windowMilliseconds: readPositiveInteger(environment, "LINGOBRIDGE_RATE_WINDOW_MS", 60_000),
      },
      originPolicy: createOriginPolicy(allowedOrigins, translationMode === "fake"),
      providerTimeoutMilliseconds: readPositiveInteger(
        environment,
        "LINGOBRIDGE_PROVIDER_TIMEOUT_MS",
        developmentSecurityConfig.providerTimeoutMilliseconds,
      ),
      requireOrigin: translationMode === "live",
    },
    serviceVersion: environment.npm_package_version ?? "0.1.0",
    translationMode,
  };
}
