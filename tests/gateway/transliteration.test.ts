import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../../apps/gateway/src/app";
import type { ExplanationAdapter } from "../../apps/gateway/src/explanation-adapter";
import { FakeExplanationAdapter } from "../../apps/gateway/src/fake-explanation-adapter";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import { FallbackExplanationAdapter } from "../../apps/gateway/src/fallback-explanation-adapter";
import {
  devanagariShare,
  NvidiaExplanationAdapter,
  TRANSLITERATION_SYSTEM_PROMPT,
} from "../../apps/gateway/src/nvidia-explanation-adapter";
import type {
  NvidiaChatCompletionRequest,
  NvidiaTranslationClient,
} from "../../apps/gateway/src/nvidia-translation-adapter";
import { TranslationAdapterError } from "../../apps/gateway/src/translation-adapter";
import {
  ANONYMOUS_INSTALLATION_HEADER,
  GATEWAY_ROUTES,
  translationErrorSchema,
  type TransliterationRequest,
  transliterationResultSchema,
} from "../../packages/contracts/src/index";

const request: TransliterationRequest = {
  consent: {
    acceptedAt: "2026-09-17T00:00:00.000Z",
    google: false,
    googleBackup: false,
    myMemory: true,
    nvidia: true,
    nvidiaBackup: true,
    transliteration: true,
    version: "mymemory-primary-nvidia-backup-v2",
  },
  operation: "transliterate",
  requestId: "0b8d9c1e-6f7a-4d3b-9e2c-5a1b7c8d9e0f",
  sourceLanguage: "ne",
  text: "timi mero vai ho",
};

function post(app: ReturnType<typeof createGatewayApp>, body: unknown) {
  return app.request(GATEWAY_ROUTES.transliterate, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      [ANONYMOUS_INSTALLATION_HEADER]: "1fb7891e-277d-4cba-aaf9-f7d33703f67e",
    },
    method: "POST",
  });
}

function testApp(explanationAdapter: ExplanationAdapter | null = new FakeExplanationAdapter(0)) {
  return createGatewayApp({
    explanationAdapter,
    logger: { info: () => undefined },
    translationAdapter: new FakeTranslationAdapter(0),
  });
}

function scriptedClient(answers: string[]) {
  const calls: NvidiaChatCompletionRequest[] = [];
  const client: NvidiaTranslationClient = {
    async createChatCompletion(chat) {
      calls.push(chat);
      return { choices: [{ message: { content: answers.shift() ?? "" } }] };
    },
  };
  return { calls, client };
}

describe("transliterate route", () => {
  it("returns a contract-valid rewrite for a consented request", async () => {
    const response = await post(testApp(), request);
    expect(response.status).toBe(200);
    const result = transliterationResultSchema.parse(await response.json());
    expect(result.requestId).toBe(request.requestId);
  });

  it("refuses requests without script-conversion consent", async () => {
    const { transliteration: _flag, ...consent } = request.consent;
    const response = await post(testApp(), { ...request, consent });
    expect(response.status).toBe(400);
    expect(translationErrorSchema.parse(await response.json()).code).toBe("invalid-request");
  });

  it("refuses languages other than Nepali", async () => {
    expect((await post(testApp(), { ...request, sourceLanguage: "hi" })).status).toBe(400);
  });

  it("says conversion is not set up when no provider is configured", async () => {
    const response = await post(testApp(null), request);
    expect(response.status).toBe(503);
  });
});

describe("NvidiaExplanationAdapter.transliterate", () => {
  it("returns the Devanagari rewrite and keeps the text marked as untrusted", async () => {
    const { calls, client } = scriptedClient(['{"text": "तिमी मेरो भाइ हो"}']);
    const adapter = new NvidiaExplanationAdapter(client, "model", 512, 0);
    const result = await adapter.transliterate(request, new AbortController().signal);
    expect(result).toMatchObject({ provider: "nvidia", text: "तिमी मेरो भाइ हो" });
    expect(calls[0]?.messages[0]?.content).toBe(TRANSLITERATION_SYSTEM_PROMPT);
    expect(calls[0]?.messages[1]?.content).toBe("<text>timi mero vai ho</text>");
  });

  it("asks once more when the first answer is not JSON", async () => {
    const { calls, client } = scriptedClient(["Sure!", '{"text": "मलाई भोक लाग्यो"}']);
    const adapter = new NvidiaExplanationAdapter(client, "model", 512, 0);
    const result = await adapter.transliterate(
      { ...request, text: "malai bhok lagyo" },
      new AbortController().signal,
    );
    expect(result.text).toBe("मलाई भोक लाग्यो");
    expect(calls).toHaveLength(2);
  });

  it("rejects an English translation instead of a rewrite", async () => {
    const { client } = scriptedClient(['{"text": "You are my brother"}']);
    const adapter = new NvidiaExplanationAdapter(client, "model", 512, 0);
    await expect(
      adapter.transliterate(request, new AbortController().signal),
    ).rejects.toBeInstanceOf(TranslationAdapterError);
  });

  it("rejects an answer far longer than the text, which is an explanation", async () => {
    const { client } = scriptedClient([JSON.stringify({ text: "भाइ ".repeat(40) })]);
    const adapter = new NvidiaExplanationAdapter(client, "model", 512, 0);
    await expect(
      adapter.transliterate(request, new AbortController().signal),
    ).rejects.toBeInstanceOf(TranslationAdapterError);
  });

  it("measures the Devanagari share over letters only", () => {
    expect(devanagariShare("के छ bro?")).toBeCloseTo(2 / 5);
    expect(devanagariShare("123 !")).toBe(0);
  });
});

describe("FallbackExplanationAdapter.transliterate", () => {
  function adapters(consent: TransliterationRequest["consent"]) {
    const failing = new NvidiaExplanationAdapter(scriptedClient(["no", "no"]).client, "m", 64, 0);
    const backup = scriptedClient(['{"text": "तिमी मेरो भाइ हो"}']);
    const fallback = new NvidiaExplanationAdapter(backup.client, "m", 64, 0, "openrouter");
    const adapter = new FallbackExplanationAdapter({
      fallback,
      primary: failing,
      primaryTimeoutMilliseconds: 1_000,
    });
    return {
      backup,
      run: () => adapter.transliterate({ ...request, consent }, new AbortController().signal),
    };
  }

  it("uses OpenRouter when NVIDIA gives an unusable answer", async () => {
    const { run } = adapters(request.consent);
    expect((await run()).provider).toBe("openrouter");
  });

  it("never contacts OpenRouter without script-conversion consent", async () => {
    const { backup, run } = adapters({ ...request.consent, transliteration: false });
    await expect(run()).rejects.toBeInstanceOf(TranslationAdapterError);
    expect(backup.calls).toHaveLength(0);
  });
});
