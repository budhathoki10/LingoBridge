import {
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
  type ExplanationRequest,
  explanationRequestSchema,
  explanationResultSchema,
  gatewayHealthSchema,
  gatewayVersionSchema,
  type TranslationError,
  type TranslationRequest,
  translationRequestSchema,
  translationResultSchema,
  type TransliterationRequest,
  transliterationRequestSchema,
  transliterationResultSchema,
  type WordUnderstandingRequest,
  wordUnderstandingRequestSchema,
  wordUnderstandingResultSchema,
} from "@lingobridge/contracts";
import {
  type GatewayClient,
  GatewayClientError,
  type GatewayServiceSnapshot,
  parseRetryAfterSeconds,
} from "./gateway-client";

export const GATEWAY_BRIDGE_REQUEST = "lingobridge:gateway:request";
export const GATEWAY_BRIDGE_ABORT = "lingobridge:gateway:abort";
export const GATEWAY_BRIDGE_PORT = "lingobridge:gateway:port";

const OPERATIONS = [
  "capabilities",
  "explain",
  "inspect-service",
  "translate",
  "transliterate",
  "understand-word",
] as const;

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

export type GatewayBridgeRequest = { id: string; type: typeof GATEWAY_BRIDGE_REQUEST } & (
  | { operation: "capabilities"; request: null }
  | { operation: "inspect-service"; request: null }
  | { operation: "explain"; request: ExplanationRequest }
  | { operation: "translate"; request: TranslationRequest }
  | { operation: "transliterate"; request: TransliterationRequest }
  | { operation: "understand-word"; request: WordUnderstandingRequest }
);

export interface GatewayBridgeAbort {
  id: string;
  type: typeof GATEWAY_BRIDGE_ABORT;
}

export interface GatewayBridgeFailure {
  code: GatewayBridgeErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number | null;
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
  if (operation === "explain") {
    const parsedExplanation = explanationRequestSchema.safeParse(value.request);
    if (!parsedExplanation.success) return null;
    return {
      id: value.id,
      operation: "explain",
      request: parsedExplanation.data,
      type: GATEWAY_BRIDGE_REQUEST,
    };
  }
  if (operation === "understand-word") {
    const parsedWord = wordUnderstandingRequestSchema.safeParse(value.request);
    if (!parsedWord.success) return null;
    return {
      id: value.id,
      operation: "understand-word",
      request: parsedWord.data,
      type: GATEWAY_BRIDGE_REQUEST,
    };
  }
  if (operation === "transliterate") {
    const parsedText = transliterationRequestSchema.safeParse(value.request);
    if (!parsedText.success) return null;
    return {
      id: value.id,
      operation: "transliterate",
      request: parsedText.data,
      type: GATEWAY_BRIDGE_REQUEST,
    };
  }
  if (operation !== "translate") {
    return {
      id: value.id,
      operation: operation as "capabilities" | "inspect-service",
      request: null,
      type: GATEWAY_BRIDGE_REQUEST,
    } as GatewayBridgeRequest;
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
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    code: "internal-error",
    message: "The translation could not be completed.",
    retryable: true,
    retryAfterSeconds: null,
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
    error: {
      code: code as GatewayBridgeErrorCode,
      message,
      retryable,
      retryAfterSeconds: parseRetryAfterSeconds(failure?.retryAfterSeconds),
    },
    ok: false,
  };
}

export function createBridgeGatewayClient(transport: GatewayBridgeTransport): GatewayClient {
  async function call(
    operation: GatewayBridgeOperation,
    request:
      | TranslationRequest
      | ExplanationRequest
      | TransliterationRequest
      | WordUnderstandingRequest
      | null,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw abortError();
    const id = crypto.randomUUID();
    const forwardAbort = () => {
      transport.abort({ id, type: GATEWAY_BRIDGE_ABORT });
    };
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const raw = await transport.send({
        id,
        operation,
        request,
        type: GATEWAY_BRIDGE_REQUEST,
      } as GatewayBridgeRequest);
      const parsed = parseResponse(raw);
      if (parsed.ok) return parsed.data;
      if (parsed.aborted) throw abortError();
      throw new GatewayClientError(
        parsed.error.code,
        parsed.error.message,
        parsed.error.retryable,
        parsed.error.retryAfterSeconds ?? null,
      );
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
        await call("explain", parsedRequest.data, signal),
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
      return { capabilities, ...service };
    },
    inspectService,
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
        await call("understand-word", parsedRequest.data, signal),
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
        await call("transliterate", parsedRequest.data, signal),
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
