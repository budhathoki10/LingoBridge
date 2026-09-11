import {
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
  gatewayHealthSchema,
  gatewayVersionSchema,
  type TranslationError,
  type TranslationRequest,
  translationRequestSchema,
  translationResultSchema,
} from "@lingobridge/contracts";
import {
  type GatewayClient,
  GatewayClientError,
  type GatewayServiceSnapshot,
} from "./gateway-client";

export const GATEWAY_BRIDGE_REQUEST = "lingobridge:gateway:request";
export const GATEWAY_BRIDGE_ABORT = "lingobridge:gateway:abort";
export const GATEWAY_BRIDGE_PORT = "lingobridge:gateway:port";

const OPERATIONS = ["capabilities", "inspect-service", "translate"] as const;

type GatewayBridgeErrorCode = TranslationError["code"] | "invalid-response" | "network-unavailable";

const ERROR_CODES: readonly GatewayBridgeErrorCode[] = [
  "invalid-request",
  "unsupported-pair",
  "rate-limited",
  "provider-unavailable",
  "timeout",
  "cancelled",
  "internal-error",
  "invalid-response",
  "network-unavailable",
];

export type GatewayBridgeOperation = (typeof OPERATIONS)[number];

export interface GatewayBridgeRequest {
  id: string;
  operation: GatewayBridgeOperation;
  request: TranslationRequest | null;
  type: typeof GATEWAY_BRIDGE_REQUEST;
}

export interface GatewayBridgeAbort {
  id: string;
  type: typeof GATEWAY_BRIDGE_ABORT;
}

export interface GatewayBridgeFailure {
  code: GatewayBridgeErrorCode;
  message: string;
  retryable: boolean;
}

export type GatewayBridgeResponse =
  | { data: unknown; ok: true }
  | { aborted: true; ok: false }
  | { aborted: false; error: GatewayBridgeFailure; ok: false };

export interface GatewayBridgeTransport {
  abort(message: GatewayBridgeAbort): void;
  send(message: GatewayBridgeRequest): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBridgeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

export function parseGatewayBridgeRequest(value: unknown): GatewayBridgeRequest | null {
  if (!isRecord(value) || value.type !== GATEWAY_BRIDGE_REQUEST || !isBridgeId(value.id)) {
    return null;
  }
  const operation = value.operation;
  if (typeof operation !== "string" || !OPERATIONS.includes(operation as GatewayBridgeOperation)) {
    return null;
  }
  if (operation !== "translate") {
    return {
      id: value.id,
      operation: operation as GatewayBridgeOperation,
      request: null,
      type: GATEWAY_BRIDGE_REQUEST,
    };
  }
  const parsedRequest = translationRequestSchema.safeParse(value.request);
  if (!parsedRequest.success) return null;
  return {
    id: value.id,
    operation: "translate",
    request: parsedRequest.data,
    type: GATEWAY_BRIDGE_REQUEST,
  };
}

export function parseGatewayBridgeAbort(value: unknown): GatewayBridgeAbort | null {
  if (!isRecord(value) || value.type !== GATEWAY_BRIDGE_ABORT || !isBridgeId(value.id)) return null;
  return { id: value.id, type: GATEWAY_BRIDGE_ABORT };
}

export function toGatewayBridgeFailure(error: unknown): GatewayBridgeFailure {
  if (error instanceof GatewayClientError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "internal-error",
    message: "The translation could not be completed.",
    retryable: true,
  };
}

function abortError(): DOMException {
  return new DOMException("The translation was cancelled.", "AbortError");
}

function parseResponse(value: unknown): GatewayBridgeResponse {
  if (!isRecord(value)) {
    throw new GatewayClientError(
      "invalid-response",
      "LingoBridge could not reach its background worker. Reload the extension, then reload this page.",
      true,
    );
  }
  if (value.ok === true) return { data: value.data, ok: true };
  if (value.aborted === true) return { aborted: true, ok: false };
  const failure = isRecord(value.error) ? value.error : null;
  const code = failure?.code;
  const message = failure?.message;
  const retryable = failure?.retryable;
  if (
    typeof code !== "string" ||
    !ERROR_CODES.includes(code as GatewayBridgeErrorCode) ||
    typeof message !== "string" ||
    message.length === 0 ||
    typeof retryable !== "boolean"
  ) {
    throw new GatewayClientError(
      "invalid-response",
      "The LingoBridge background worker returned an unreadable error.",
      true,
    );
  }
  return {
    aborted: false,
    error: { code: code as GatewayBridgeErrorCode, message, retryable },
    ok: false,
  };
}

export function createBridgeGatewayClient(transport: GatewayBridgeTransport): GatewayClient {
  async function call(
    operation: GatewayBridgeOperation,
    request: TranslationRequest | null,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw abortError();
    const id = crypto.randomUUID();
    const forwardAbort = () => {
      transport.abort({ id, type: GATEWAY_BRIDGE_ABORT });
    };
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const raw = await transport.send({ id, operation, request, type: GATEWAY_BRIDGE_REQUEST });
      const parsed = parseResponse(raw);
      if (parsed.ok) return parsed.data;
      if (parsed.aborted) throw abortError();
      throw new GatewayClientError(parsed.error.code, parsed.error.message, parsed.error.retryable);
    } catch (error) {
      if (error instanceof DOMException) throw error;
      if (signal?.aborted) throw abortError();
      if (error instanceof GatewayClientError) throw error;
      throw new GatewayClientError(
        "network-unavailable",
        "LingoBridge lost its background worker. Reload this page and try again.",
        true,
      );
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  async function getCapabilities(signal?: AbortSignal): Promise<CapabilityCatalogue> {
    const parsed = capabilityCatalogueSchema.safeParse(await call("capabilities", null, signal));
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
    const snapshot = await call("inspect-service", null, signal);
    const record = isRecord(snapshot) ? snapshot : {};
    const parsedHealth = gatewayHealthSchema.safeParse(record.health);
    const parsedVersion = gatewayVersionSchema.safeParse(record.version);
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
      return { capabilities, ...service };
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
      const parsedResult = translationResultSchema.safeParse(
        await call("translate", parsedRequest.data, signal),
      );
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
