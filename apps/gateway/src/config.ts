import type { OperationsThresholds } from "./operational-metrics.js";
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
  explanationMaxTokens: number;
  explanationModel: string;
  explanationPrimaryTimeoutMilliseconds: number;
  explanationTimeoutMilliseconds: number;
  googleProjectId: string | null;
  hostname: string;
  myMemoryBaseUrl: string;
  myMemoryContactEmail: string | null;
  myMemoryPrivateKey: string | null;
  myMemoryRapidApiHost: string;
  myMemoryRapidApiKey: string | null;
  nvidiaApiKey: string | null;
  nvidiaBaseUrl: string;
  nvidiaMaxTokens: number;
  nvidiaModel: string;
  openRouterApiKey: string | null;
  openRouterBaseUrl: string;
  openRouterModel: string;
  operationsMetricsToken: string | null;
  operationsThresholds: OperationsThresholds;
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

function readMyMemoryContactEmail(environment: GatewayEnvironment): string | null {
  const email = environment.MYMEMORY_CONTACT_EMAIL?.trim();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("MYMEMORY_CONTACT_EMAIL must be a valid email address.");
  }
  return email;
}

/**
 * MyMemory meters its free tier against the caller's IP address, and the email in `de` only
 * raises that address's ceiling. A Render instance shares one egress address with every other
 * free service on the host, so neighbouring traffic can exhaust the day's characters before a
 * single request of ours arrives. A RapidAPI subscription key moves the quota onto the account
 * that owns the key, which is the only way off the shared meter.
 */
const DEFAULT_MYMEMORY_RAPIDAPI_HOST = "mymemory-translation-memory1.p.rapidapi.com";

function readMyMemoryRapidApiHost(environment: GatewayEnvironment): string {
  const host = environment.MYMEMORY_RAPIDAPI_HOST?.trim() || DEFAULT_MYMEMORY_RAPIDAPI_HOST;
  if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.rapidapi\.com$/u.test(host)) {
    throw new Error("MYMEMORY_RAPIDAPI_HOST must be a rapidapi.com hostname.");
  }
  return host;
}

function readOptionalPositiveNumber(environment: GatewayEnvironment, name: string): number | null {
  const rawValue = environment[name]?.trim();
  if (!rawValue) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function readOperationsMetricsToken(environment: GatewayEnvironment): string | null {
  const token = environment.LINGOBRIDGE_OPERATIONS_METRICS_TOKEN?.trim();
  if (!token) return null;
  if (token.length < 32) {
    throw new Error("LINGOBRIDGE_OPERATIONS_METRICS_TOKEN must be at least 32 characters.");
  }
  return token;
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
  const myMemoryContactEmail = readMyMemoryContactEmail(environment);
  const nvidiaApiKey = readNvidiaApiKey(environment);
  if (translationMode === "live" && !myMemoryContactEmail) {
    throw new Error("Live mode requires MYMEMORY_CONTACT_EMAIL.");
  }
  if (translationMode === "live" && !nvidiaApiKey) {
    throw new Error("Live mode requires NVIDIA_API_KEY.");
  }

  const explanationModel =
    environment.NVIDIA_EXPLANATION_MODEL?.trim() || "nvidia/nemotron-3-ultra-550b-a55b";
  if (!/^[a-z0-9-]{1,40}\/[a-z0-9._-]{1,100}$/u.test(explanationModel)) {
    throw new Error("NVIDIA_EXPLANATION_MODEL must be an NVIDIA API catalog model ID.");
  }

  const openRouterModel = environment.OPENROUTER_MODEL?.trim() || "nex-agi/nex-n2.5-pro:free";
  if (!/^[a-z0-9-]{1,40}\/[a-z0-9._-]{1,100}(?::[a-z0-9-]{1,20})?$/u.test(openRouterModel)) {
    throw new Error("OPENROUTER_MODEL must be an OpenRouter model ID.");
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
    explanationMaxTokens: readPositiveInteger(environment, "NVIDIA_EXPLANATION_MAX_TOKENS", 4_096),
    explanationModel,
    explanationPrimaryTimeoutMilliseconds: readPositiveInteger(
      environment,
      "LINGOBRIDGE_EXPLANATION_PRIMARY_TIMEOUT_MS",
      20_000,
    ),
    explanationTimeoutMilliseconds: readPositiveInteger(
      environment,
      "LINGOBRIDGE_EXPLANATION_TIMEOUT_MS",
      90_000,
    ),
    googleProjectId: translationMode === "live" ? googleProjectId : null,
    hostname: environment.HOST ?? "127.0.0.1",
    myMemoryBaseUrl: environment.MYMEMORY_BASE_URL ?? "https://api.mymemory.translated.net",
    myMemoryContactEmail: translationMode === "live" ? myMemoryContactEmail : null,
    myMemoryPrivateKey:
      translationMode === "live" ? environment.MYMEMORY_PRIVATE_KEY?.trim() || null : null,
    myMemoryRapidApiHost: readMyMemoryRapidApiHost(environment),
    myMemoryRapidApiKey:
      translationMode === "live" ? environment.MYMEMORY_RAPIDAPI_KEY?.trim() || null : null,
    nvidiaApiKey: translationMode === "live" ? nvidiaApiKey : null,
    nvidiaBaseUrl: environment.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    nvidiaMaxTokens: readPositiveInteger(environment, "NVIDIA_MAX_TOKENS", 2_048),
    nvidiaModel: environment.NVIDIA_MODEL ?? "nvidia/riva-translate-4b-instruct-v2",
    openRouterApiKey:
      translationMode === "live" ? environment.OPENROUTER_API_KEY?.trim() || null : null,
    openRouterBaseUrl: environment.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    openRouterModel,
    operationsMetricsToken: readOperationsMetricsToken(environment),
    operationsThresholds: {
      characterQuota: readOptionalPositiveNumber(environment, "LINGOBRIDGE_CHARACTER_QUOTA"),
      costWarningUsd: readOptionalPositiveNumber(environment, "LINGOBRIDGE_COST_WARNING_USD"),
      googlePricePerMillionCharactersUsd:
        readOptionalPositiveNumber(environment, "LINGOBRIDGE_GOOGLE_PRICE_PER_MILLION_USD") ?? 20,
      nvidiaPricePerMillionCharactersUsd:
        readOptionalPositiveNumber(environment, "LINGOBRIDGE_NVIDIA_PRICE_PER_MILLION_USD") ?? 0,
    },
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
