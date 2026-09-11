import { describe, expect, it } from "vitest";
import {
  createBridgeGatewayClient,
  type GatewayBridgeResponse,
  parseGatewayBridgeAbort,
  parseGatewayBridgeRequest,
  toGatewayBridgeFailure,
} from "../../apps/extension/lib/gateway-bridge";
import {
  createGatewayClient,
  type GatewayClientError,
  type GatewayFetch,
} from "../../apps/extension/lib/gateway-client";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import type { TranslationRequest } from "../../packages/contracts/src/index";

const request: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-07T00:00:00.000Z",
    google: true,
    googleBackup: true,
    nvidia: true,
    version: "phase-3.1-fake-gateway",
  },
  operation: "translate",
  requestId: "6de8999e-0aad-4ba9-bc94-7cc8bf628126",
  sourceLanguage: "es",
  targetLanguage: "en",
  text: "Gracias",
};

function appFetcher(delayMilliseconds = 0): GatewayFetch {
  const app = createGatewayApp({
    logger: { info: () => undefined },
    translationAdapter: new FakeTranslationAdapter(delayMilliseconds),
  });
  return async (input, init) => app.request(new Request(input, init));
}

/** Mirrors the background worker: it parses the message, then calls the gateway itself. */
function createFakeBackground(delayMilliseconds = 0) {
  const client = createGatewayClient({
    baseUrl: "http://gateway.test",
    fetcher: appFetcher(delayMilliseconds),
    installationIdProvider: async () => "51e8bfee-b285-46ba-928c-44e914935634",
  });
  const controllers = new Map<string, AbortController>();
  const seen: unknown[] = [];

  async function handle(message: unknown): Promise<GatewayBridgeResponse | { ok: true }> {
    seen.push(message);
    const abort = parseGatewayBridgeAbort(message);
    if (abort) {
      controllers.get(abort.id)?.abort();
      controllers.delete(abort.id);
      return { ok: true };
    }
    const parsed = parseGatewayBridgeRequest(message);
    if (!parsed) {
      return {
        aborted: false,
        error: { code: "invalid-request", message: "Rejected message.", retryable: false },
        ok: false,
      };
    }
    const controller = new AbortController();
    controllers.set(parsed.id, controller);
    try {
      if (parsed.operation === "capabilities") {
        return { data: await client.getCapabilities(controller.signal), ok: true };
      }
      if (parsed.operation === "inspect-service") {
        return { data: await client.inspectService(controller.signal), ok: true };
      }
      return {
        data: await client.translate(parsed.request as TranslationRequest, controller.signal),
        ok: true,
      };
    } catch (error) {
      if (controller.signal.aborted) return { aborted: true, ok: false };
      return { aborted: false, error: toGatewayBridgeFailure(error), ok: false };
    } finally {
      controllers.delete(parsed.id);
    }
  }

  return {
    handle,
    seen,
    transport: {
      abort(message: unknown) {
        void handle(message);
      },
      send: handle,
    },
  };
}

describe("gateway bridge", () => {
  it("translates and reads capabilities through the background worker", async () => {
    const background = createFakeBackground();
    const client = createBridgeGatewayClient(background.transport);

    const snapshot = await client.inspect();
    const result = await client.translate(request, new AbortController().signal);

    expect(snapshot.version.translationMode).toBe("fake");
    expect(snapshot.capabilities.languages.some((language) => language.code === "es")).toBe(true);
    expect(result.translatedText).toBe("Thank you");
    expect(result.requestId).toBe(request.requestId);
  });

  it("rejects malformed and unknown bridge messages before any gateway call", () => {
    expect(
      parseGatewayBridgeRequest({
        id: "a",
        operation: "drop-tables",
        type: "lingobridge:gateway:request",
      }),
    ).toBeNull();
    expect(
      parseGatewayBridgeRequest({
        id: "",
        operation: "capabilities",
        type: "lingobridge:gateway:request",
      }),
    ).toBeNull();
    expect(
      parseGatewayBridgeRequest({
        id: "a",
        operation: "translate",
        request: { text: "no contract" },
        type: "lingobridge:gateway:request",
      }),
    ).toBeNull();
    expect(parseGatewayBridgeRequest("lingobridge:gateway:request")).toBeNull();
    expect(parseGatewayBridgeAbort({ id: "a", type: "lingobridge:gateway:request" })).toBeNull();
  });

  it("carries a gateway failure back with its code and retryable flag", async () => {
    const client = createBridgeGatewayClient({
      abort: () => undefined,
      send: async () => ({
        aborted: false,
        error: { code: "rate-limited", message: "Too many requests.", retryable: true },
        ok: false,
      }),
    });

    await expect(client.translate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "rate-limited",
      name: "GatewayClientError",
      retryable: true,
    } satisfies Partial<GatewayClientError>);
  });

  it("treats an unreadable background answer as an invalid response", async () => {
    const client = createBridgeGatewayClient({
      abort: () => undefined,
      send: async () => ({ ok: false }),
    });

    await expect(client.translate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "invalid-response",
      name: "GatewayClientError",
    } satisfies Partial<GatewayClientError>);
  });

  it("cancels an in-flight translation and tells the background worker to stop", async () => {
    const background = createFakeBackground(50);
    const client = createBridgeGatewayClient(background.transport);
    const controller = new AbortController();

    const pending = client.translate(request, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(
      background.seen.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === "lingobridge:gateway:abort",
      ),
    ).toBe(true);
  });
});
