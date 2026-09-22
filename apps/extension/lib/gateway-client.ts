import {
  ANONYMOUS_INSTALLATION_HEADER,
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
  type ExplanationRequest,
  type ExplanationResult,
  explanationRequestSchema,
  explanationResultSchema,
  GATEWAY_ROUTES,
  type GatewayHealth,
  type GatewayVersion,
  gatewayHealthSchema,
  gatewayVersionSchema,
  type TranslationError,
  type TranslationRequest,
  type TranslationResult,
  translationErrorSchema,
  translationRequestSchema,
  translationResultSchema,
  type TransliterationRequest,
  type TransliterationResult,
  transliterationRequestSchema,
  transliterationResultSchema,
  type WordUnderstandingRequest,
  type WordUnderstandingResult,
  wordUnderstandingRequestSchema,
  wordUnderstandingResultSchema,
} from "@lingobridge/contracts";
import { GATEWAY_ORIGIN } from "./gateway-config";
import { getAnonymousInstallationId } from "./installation-id";

export type GatewayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GatewaySnapshot {
  capabilities: CapabilityCatalogue;
  health: GatewayHealth;
  version: GatewayVersion;
}

export interface GatewayServiceSnapshot {
  health: GatewayHealth;
  version: GatewayVersion;
}

export class GatewayClientError extends Error {
  readonly code: TranslationError["code"] | "invalid-response" | "network-unavailable";
  readonly retryable: boolean;

  constructor(
    code: TranslationError["code"] | "invalid-response" | "network-unavailable",
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "GatewayClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface GatewayClient {
  explain(request: ExplanationRequest, signal: AbortSignal): Promise<ExplanationResult>;
  getCapabilities(signal?: AbortSignal): Promise<CapabilityCatalogue>;
  inspect(signal?: AbortSignal): Promise<GatewaySnapshot>;
  inspectService(signal?: AbortSignal): Promise<GatewayServiceSnapshot>;
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
  transliterate(
    request: TransliterationRequest,
    signal: AbortSignal,
  ): Promise<TransliterationResult>;
  understandWord(
    request: WordUnderstandingRequest,
    signal: AbortSignal,
  ): Promise<WordUnderstandingResult>;
}

interface GatewayClientOptions {
  baseUrl?: string;
  fetcher?: GatewayFetch;
  installationIdProvider?: () => Promise<string>;
}

function endpoint(baseUrl: string, route: string): string {
  return new URL(route, `${baseUrl.replace(/\/$/u, "")}/`).toString();
}

/**
 * How long to wait before each retry. The hosted gateway runs on an instance that sleeps when
 * idle and is swapped out on every deploy, and during those windows the host answers with its
 * own error page instead of the gateway.
 *
 * The budget is set from a measured restart: a deploy on 2026-09-22 took 21 seconds from
 * "Deploying" to "service is live", and the host warns that waking a sleeping instance can add
 * 50 seconds. These delays total 35 seconds over six attempts, which covers a restart and most
 * of a wake-up. Longer would outlast the patience the panel's spinner can ask for, and the user
 * can close the panel to abort at any point.
 */
const RETRY_DELAYS_MS = [1000, 3000, 6000, 10_000, 15_000];
  
/** A body the gateway did not write. Every gateway answer, including its errors, is JSON. */
const NOT_JSON = Symbol("not-json");

function abortError(): DOMException {
  return new DOMException("The gateway request was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isLocalGateway(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Raised when nothing answered, or when something other than the gateway did. The local hint
 * would be nonsense against the hosted gateway, which the user cannot start.
 */
function unreachable(baseUrl: string): GatewayClientError {
  return new GatewayClientError(
    "network-unavailable",
    isLocalGateway(baseUrl)
      ? "The local LingoBridge gateway is not running. Start it with pnpm dev:gateway."
      : "LingoBridge could not reach the translation service. It may still be waking up, so try again in a moment.",
    true,
  );
}

async function parseJson(response: Response): Promise<unknown | typeof NOT_JSON> {
  try {
    return await response.json();
  } catch {
    return NOT_JSON;
  }
}

function requestFailure(payload: unknown, response: Response): GatewayClientError {
  const parsedError = translationErrorSchema.safeParse(payload);
  if (parsedError.success) {
    return new GatewayClientError(
      parsedError.data.code,
      parsedError.data.message,
      parsedError.data.retryable,
    );
  }

  return new GatewayClientError(
    "invalid-response",
    `The gateway returned an unexpected ${response.status} response.`,
    response.status >= 500,
  );
}

export function createGatewayClient(options: GatewayClientOptions = {}): GatewayClient {
  const baseUrl = options.baseUrl ?? GATEWAY_ORIGIN;
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const installationIdProvider = options.installationIdProvider ?? getAnonymousInstallationId;

  /**
   * Sends one request, retrying only the failures that mean the gateway never answered: a
   * transport error, or a body it did not write. A JSON error from the gateway is its own
   * verdict and is surfaced at once, so a retry can never spend provider quota twice.
   */
  async function requestJson(
    route: string,
    init: { body?: string; headers?: Record<string, string>; method: "GET" | "POST" },
    signal?: AbortSignal,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const retryDelay = RETRY_DELAYS_MS[attempt];
      let response: Response;
      try {
        const installationId = await installationIdProvider();
        response = await fetcher(endpoint(baseUrl, route), {
          ...init,
          headers: { ...init.headers, [ANONYMOUS_INSTALLATION_HEADER]: installationId },
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (retryDelay === undefined) throw unreachable(baseUrl);
        await delay(retryDelay, signal);
        continue;
      }

      const payload = await parseJson(response);
      if (payload === NOT_JSON) {
        if (retryDelay === undefined) throw unreachable(baseUrl);
        await delay(retryDelay, signal);
        continue;
      }

      if (!response.ok) throw requestFailure(payload, response);
      return payload;
    }
  }

  async function get(route: string, signal?: AbortSignal): Promise<unknown> {
    return requestJson(route, { method: "GET" }, signal);
  }

  async function post(route: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    return requestJson(
      route,
      {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      signal,
    );
  }

  async function getCapabilities(signal?: AbortSignal): Promise<CapabilityCatalogue> {
    const parsed = capabilityCatalogueSchema.safeParse(
      await get(GATEWAY_ROUTES.capabilities, signal),
    );
    if (!parsed.success) {
      throw new GatewayClientError(
        "invalid-response",
        "The gateway language catalogue did not match the shared contract.",
        true,
      );
    }
    return parsed.data;
  }

  async function inspectService(signal?: AbortSignal): Promise<GatewayServiceSnapshot> {
    const [health, version] = await Promise.all([
      get(GATEWAY_ROUTES.health, signal),
      get(GATEWAY_ROUTES.version, signal),
    ]);
    const parsedHealth = gatewayHealthSchema.safeParse(health);
    const parsedVersion = gatewayVersionSchema.safeParse(version);
    if (!parsedHealth.success || !parsedVersion.success) {
      throw new GatewayClientError(
        "invalid-response",
        "The gateway information did not match the shared contract.",
        true,
      );
    }
    return { health: parsedHealth.data, version: parsedVersion.data };
  }

  return {
    async explain(request, signal) {
      const parsedRequest = explanationRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        throw new GatewayClientError(
          "invalid-request",
          "The explanation request did not match the shared contract.",
          false,
        );
      }
      const parsedResult = explanationResultSchema.safeParse(
        await post(GATEWAY_ROUTES.explain, parsedRequest.data, signal),
      );
      if (!parsedResult.success) {
        throw new GatewayClientError(
          "invalid-response",
          "The gateway explanation did not match the shared contract.",
          true,
        );
      }
      return parsedResult.data;
    },
    getCapabilities,
    async inspect(signal) {
      const [service, capabilities] = await Promise.all([
        inspectService(signal),
        getCapabilities(signal),
      ]);
      return {
        capabilities,
        ...service,
      };
    },
    inspectService,

    async transliterate(request, signal) {
      const parsedRequest = transliterationRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        throw new GatewayClientError(
          "invalid-request",
          "The script conversion request did not match the shared contract.",
          false,
        );
      }
      const parsedResult = transliterationResultSchema.safeParse(
        await post(GATEWAY_ROUTES.transliterate, parsedRequest.data, signal),
      );
      if (!parsedResult.success) {
        throw new GatewayClientError(
          "invalid-response",
          "The gateway script conversion did not match the shared contract.",
          true,
        );
      }
      return parsedResult.data;
    },

    async understandWord(request, signal) {
      const parsedRequest = wordUnderstandingRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        throw new GatewayClientError(
          "invalid-request",
          "The word-understanding request did not match the shared contract.",
          false,
        );
      }
      const parsedResult = wordUnderstandingResultSchema.safeParse(
        await post(GATEWAY_ROUTES.understandWord, parsedRequest.data, signal),
      );
      if (!parsedResult.success) {
        throw new GatewayClientError(
          "invalid-response",
          "The gateway word explanation did not match the shared contract.",
          true,
        );
      }
      return parsedResult.data;
    },

    async translate(request, signal) {
      const parsedRequest = translationRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        throw new GatewayClientError(
          "invalid-request",
          "The translation request did not match the shared contract.",
          false,
        );
      }

      const payload = await post(GATEWAY_ROUTES.translate, parsedRequest.data, signal);
      const parsedResult = translationResultSchema.safeParse(payload);
      if (!parsedResult.success) {
        throw new GatewayClientError(
          "invalid-response",
          "The gateway translation did not match the shared contract.",
          true,
        );
      }

      return parsedResult.data;
    },
  };
}

export const gatewayClient = createGatewayClient();
