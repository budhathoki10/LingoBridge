import { describe, expect, it } from "vitest";
import type { ExplanationAdapter } from "../../apps/gateway/src/explanation-adapter";
import { FallbackExplanationAdapter } from "../../apps/gateway/src/fallback-explanation-adapter";
import { NvidiaExplanationAdapter } from "../../apps/gateway/src/nvidia-explanation-adapter";
import type {
  NvidiaChatCompletionRequest,
  NvidiaTranslationClient,
} from "../../apps/gateway/src/nvidia-translation-adapter";
import { TranslationAdapterError } from "../../apps/gateway/src/translation-adapter";
import type {
  ExplanationRequest,
  WordUnderstandingRequest,
  WordUnderstandingResult,
} from "../../packages/contracts/src/index";

const consent = {
  acceptedAt: "2026-09-17T00:00:00.000Z",
  nvidia: true as const,
  openRouter: true,
  version: "explain-nvidia-openrouter-v2",
};

const wordRequest: WordUnderstandingRequest = {
  consent,
  operation: "understand-word",
  requestId: "0b8d9c1e-6f7a-4d3b-9e2c-5a1b7c8d9e0f",
  sourceLanguage: "en",
  sourceText: "A cow has a four-chambered stomach.",
  targetLanguage: "ne",
  translatedText: "गाईको चार कोठा भएको पेट हुन्छ।",
  word: "chambered",
};

const explainRequest: ExplanationRequest = {
  consent,
  operation: "explain",
  requestId: wordRequest.requestId,
  sourceLanguage: "en",
  sourceText: wordRequest.sourceText,
  targetLanguage: "ne",
  translatedText: wordRequest.translatedText,
};

function wordResult(provider: "nvidia" | "openrouter"): WordUnderstandingResult {
  return {
    contextMeaning: "पेट चार भागमा बाँडिएको।",
    example: "The heart is four-chambered.",
    meaning: "कोठा भएको",
    partOfSpeech: "adjective",
    pronunciation: null,
    provider,
    requestId: wordRequest.requestId,
    translation: "कोठा भएको",
    word: "chambered",
  };
}

class ScriptedAdapter implements ExplanationAdapter {
  calls = 0;
  lastSignal: AbortSignal | null = null;

  constructor(
    private readonly behaviour: (signal: AbortSignal) => Promise<WordUnderstandingResult>,
  ) {}

  async explain(): Promise<never> {
    this.calls += 1;
    throw new TranslationAdapterError("provider-unavailable", "unavailable", true);
  }

  async transliterate(): Promise<never> {
    this.calls += 1;
    throw new TranslationAdapterError("provider-unavailable", "unavailable", true);
  }

  understandWord(_request: WordUnderstandingRequest, signal: AbortSignal) {
    this.calls += 1;
    this.lastSignal = signal;
    return this.behaviour(signal);
  }
}

const unavailable = () =>
  Promise.reject(new TranslationAdapterError("provider-unavailable", "unavailable", true));

function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
  });
}

describe("FallbackExplanationAdapter", () => {
  it("uses NVIDIA when it answers and never contacts OpenRouter", async () => {
    const primary = new ScriptedAdapter(async () => wordResult("nvidia"));
    const fallback = new ScriptedAdapter(async () => wordResult("openrouter"));
    const adapter = new FallbackExplanationAdapter({
      fallback,
      primary,
      primaryTimeoutMilliseconds: 1_000,
    });

    const result = await adapter.understandWord(wordRequest, new AbortController().signal);
    expect(result.provider).toBe("nvidia");
    expect(fallback.calls).toBe(0);
  });

  it("asks OpenRouter once when NVIDIA fails", async () => {
    const primary = new ScriptedAdapter(unavailable);
    const fallback = new ScriptedAdapter(async () => wordResult("openrouter"));
    const adapter = new FallbackExplanationAdapter({
      fallback,
      primary,
      primaryTimeoutMilliseconds: 1_000,
    });

    const result = await adapter.understandWord(wordRequest, new AbortController().signal);
    expect(result.provider).toBe("openrouter");
    expect([primary.calls, fallback.calls]).toEqual([1, 1]);
  });

  it("stops waiting on a slow NVIDIA and asks OpenRouter instead", async () => {
    const primary = new ScriptedAdapter(hangUntilAborted);
    const fallback = new ScriptedAdapter(async () => wordResult("openrouter"));
    const adapter = new FallbackExplanationAdapter({
      fallback,
      primary,
      primaryTimeoutMilliseconds: 20,
    });

    const result = await adapter.understandWord(wordRequest, new AbortController().signal);
    expect(result.provider).toBe("openrouter");
    expect(primary.lastSignal?.aborted).toBe(true);
  });

  it("never sends text to OpenRouter without the reader's consent for it", async () => {
    const primary = new ScriptedAdapter(unavailable);
    const fallback = new ScriptedAdapter(async () => wordResult("openrouter"));
    const adapter = new FallbackExplanationAdapter({
      fallback,
      primary,
      primaryTimeoutMilliseconds: 1_000,
    });
    const { openRouter: _openRouter, ...nvidiaOnly } = consent;

    await expect(
      adapter.understandWord({ ...wordRequest, consent: nvidiaOnly }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
    await expect(
      adapter.explain(
        { ...explainRequest, consent: { ...consent, openRouter: false } },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(TranslationAdapterError);
    expect(fallback.calls).toBe(0);
  });

  it("does not try OpenRouter after the reader cancels", async () => {
    const controller = new AbortController();
    const primary = new ScriptedAdapter((signal) => {
      controller.abort();
      return hangUntilAborted(signal);
    });
    const fallback = new ScriptedAdapter(async () => wordResult("openrouter"));
    const adapter = new FallbackExplanationAdapter({
      fallback,
      primary,
      primaryTimeoutMilliseconds: 1_000,
    });

    await expect(adapter.understandWord(wordRequest, controller.signal)).rejects.toThrow();
    expect(fallback.calls).toBe(0);
  });

  it("reports the OpenRouter failure when both providers fail", async () => {
    const primary = new ScriptedAdapter(unavailable);
    const fallback = new ScriptedAdapter(() =>
      Promise.reject(new TranslationAdapterError("provider-unavailable", "openrouter down", true)),
    );
    const adapter = new FallbackExplanationAdapter({
      fallback,
      primary,
      primaryTimeoutMilliseconds: 1_000,
    });

    await expect(
      adapter.understandWord(wordRequest, new AbortController().signal),
    ).rejects.toMatchObject({ message: "openrouter down", retryable: true });
    await expect(
      adapter.explain(explainRequest, new AbortController().signal),
    ).rejects.toBeInstanceOf(TranslationAdapterError);
    expect(fallback.calls).toBe(2);
  });
});

describe("NvidiaExplanationAdapter as the OpenRouter backup", () => {
  it("labels answers as OpenRouter and omits the NVIDIA-only request option", async () => {
    const calls: NvidiaChatCompletionRequest[] = [];
    const client: NvidiaTranslationClient = {
      async createChatCompletion(request) {
        calls.push(request);
        const { provider: _provider, requestId: _requestId, ...answer } = wordResult("openrouter");
        return { choices: [{ message: { content: JSON.stringify(answer) } }] };
      },
    };
    const adapter = new NvidiaExplanationAdapter(
      client,
      "google/gemma-4-31b-it:free",
      2_048,
      0,
      "openrouter",
    );

    const result = await adapter.understandWord(wordRequest, new AbortController().signal);
    expect(result.provider).toBe("openrouter");
    expect(calls[0]?.model).toBe("google/gemma-4-31b-it:free");
    expect(calls[0]).not.toHaveProperty("chat_template_kwargs");
  });
});
