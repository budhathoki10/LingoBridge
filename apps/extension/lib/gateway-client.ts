import {
  GATEWAY_ROUTES,
  capabilityCatalogueSchema,
  gatewayHealthSchema,
  gatewayVersionSchema,
  translationErrorSchema,
  translationRequestSchema,
  translationResultSchema,
  type CapabilityCatalogue,
  type GatewayHealth,
  type GatewayVersion,
  type TranslationError,
  type TranslationRequest,
  type TranslationResult,
} from "@lingobridge/contracts";
import { GATEWAY_ORIGIN } from "./gateway-config";

export type GatewayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GatewaySnapshot {
  capabilities: CapabilityCatalogue;
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
  inspect(signal?: AbortSignal): Promise<GatewaySnapshot>;
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
}

interface GatewayClientOptions {
  baseUrl?: string;
  fetcher?: GatewayFetch;
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

  async function get(route: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;

    try {
      response = await fetcher(endpoint(baseUrl, route), { method: "GET", signal });
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

  return {
    async inspect(signal) {
      const [health, version, capabilities] = await Promise.all([
        get(GATEWAY_ROUTES.health, signal),
        get(GATEWAY_ROUTES.version, signal),
        get(GATEWAY_ROUTES.capabilities, signal),
      ]);

      const parsedHealth = gatewayHealthSchema.safeParse(health);
      const parsedVersion = gatewayVersionSchema.safeParse(version);
      const parsedCapabilities = capabilityCatalogueSchema.safeParse(capabilities);

      if (!parsedHealth.success || !parsedVersion.success || !parsedCapabilities.success) {
        throw new GatewayClientError(
          "invalid-response",
          "The gateway information did not match the shared contract.",
          true,
        );
      }

      return {
        capabilities: parsedCapabilities.data,
        health: parsedHealth.data,
        version: parsedVersion.data,
      };
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

      let response: Response;
      try {
        response = await fetcher(endpoint(baseUrl, GATEWAY_ROUTES.translate), {
          body: JSON.stringify(parsedRequest.data),
          headers: { "Content-Type": "application/json" },
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
