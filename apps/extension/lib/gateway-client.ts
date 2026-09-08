import {
  ANONYMOUS_INSTALLATION_HEADER,
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
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
  getCapabilities(signal?: AbortSignal): Promise<CapabilityCatalogue>;
  inspect(signal?: AbortSignal): Promise<GatewaySnapshot>;
  inspectService(signal?: AbortSignal): Promise<GatewayServiceSnapshot>;
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
}

interface GatewayClientOptions {
  baseUrl?: string;
  fetcher?: GatewayFetch;
  installationIdProvider?: () => Promise<string>;
}

function endpoint(baseUrl: string, route: string): string {
  return new URL(route, `${baseUrl.replace(/\/$/u, "")}/`).toString();
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GatewayClientError(
      "invalid-response",
      "The gateway returned a response that was not valid JSON.",
      true,
    );
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

  async function get(route: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;

    try {
      const installationId = await installationIdProvider();
      response = await fetcher(endpoint(baseUrl, route), {
        headers: { [ANONYMOUS_INSTALLATION_HEADER]: installationId },
        method: "GET",
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new GatewayClientError(
        "network-unavailable",
        "The local LingoBridge gateway is not running. Start it with pnpm dev:gateway.",
        true,
      );
    }

    const payload = await parseJson(response);
    if (!response.ok) throw requestFailure(payload, response);
    return payload;
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

    async translate(request, signal) {
      const parsedRequest = translationRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        throw new GatewayClientError(
          "invalid-request",
          "The translation request did not match the shared contract.",
          false,
        );
      }

      let response: Response;
      try {
        const installationId = await installationIdProvider();
        response = await fetcher(endpoint(baseUrl, GATEWAY_ROUTES.translate), {
          body: JSON.stringify(parsedRequest.data),
          headers: {
            "Content-Type": "application/json",
            [ANONYMOUS_INSTALLATION_HEADER]: installationId,
          },
          method: "POST",
          signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new GatewayClientError(
          "network-unavailable",
          "The local LingoBridge gateway is not running. Start it with pnpm dev:gateway.",
          true,
        );
      }

      const payload = await parseJson(response);
      if (!response.ok) throw requestFailure(payload, response);

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
