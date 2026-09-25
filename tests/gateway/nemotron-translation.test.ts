import { describe, expect, it } from "vitest";
import {
  isPlausibleTranslation,
  LLM_TRANSLATION_SYSTEM_PROMPT,
  NemotronTranslationAdapter,
} from "../../apps/gateway/src/nemotron-translation-adapter";
import type {
  NvidiaChatCompletionRequest,
  NvidiaChatCompletionResponse,
  NvidiaTranslationClient,
} from "../../apps/gateway/src/nvidia-translation-adapter";
import {
  createTranslationChain,
  TranslationProviderChain,
  type TranslationStepEvent,
} from "../../apps/gateway/src/provider-router";
import {
  type TranslationAdapter,
  TranslationAdapterError,
} from "../../apps/gateway/src/translation-adapter";
import {
  type TranslationRequest,
  type TranslationResult,
  translationResultSchema,
} from "../../packages/contracts/src/index";

const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

const request: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-25T00:00:00.000Z",
    google: false,
    googleBackup: false,
    myMemory: true,
    nvidia: true,
    nvidiaBackup: true,
    version: "mymemory-primary-nvidia-backup-v2",
  },
  operation: "translate",
  requestId: "1f6f7a1c-3c55-4c5e-9d3a-6a0f1c2b9e10",
  sourceLanguage: "en",
  targetLanguage: "ne",
  text: "What is your name?",
};

class ScriptedClient implements NvidiaTranslationClient {
  calls: NvidiaChatCompletionRequest[] = [];

  constructor(private readonly reply: string | (() => Promise<NvidiaChatCompletionResponse>)) {}

  async createChatCompletion(body: NvidiaChatCompletionRequest) {
    this.calls.push(body);
    if (typeof this.reply === "function") return this.reply();
    return { choices: [{ message: { content: this.reply } }] };
  }
}

const adapterFor = (client: NvidiaTranslationClient) =>
  new NemotronTranslationAdapter(client, MODEL, 4_096);

describe("NemotronTranslationAdapter", () => {
  it("asks as a strict translation engine with reasoning off and returns the translation", async () => {
    const client = new ScriptedClient(
      '{"translation": "तपाईंको नाम के हो?", "sourceLanguage": "en"}',
    );

    const result = await adapterFor(client).translate(request, new AbortController().signal);

    expect(result).toMatchObject({
      detectedSourceLanguage: "en",
      provider: "nvidia",
      targetLanguage: "ne",
      translatedText: "तपाईंको नाम के हो?",
    });
    const sent = client.calls[0];
    expect(sent).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      model: MODEL,
      temperature: 0,
    });
    expect(sent?.max_tokens).toBe(256 + Array.from(request.text).length * 4);
    expect(sent?.messages[0]).toEqual({ content: LLM_TRANSLATION_SYSTEM_PROMPT, role: "system" });
    expect(sent?.messages[1]?.content).toBe(
      "Source language: English (en)\nTarget language: Nepali (ne)\n<text>What is your name?</text>",
    );
  });

  it("reads JSON wrapped in reasoning or a code fence, and writes digits as 0-9", async () => {
    const client = new ScriptedClient(
      '<think>short</think>```json\n{"translation": "बैठक शुक्रबार ३ बजे हुन्छ।"}\n```',
    );

    const result = await adapterFor(client).translate(
      { ...request, text: "The meeting is on Friday at 3." },
      new AbortController().signal,
    );

    expect(result.translatedText).toBe("बैठक शुक्रबार 3 बजे हुन्छ।");
  });

  it.each([
    ["answers the question in English", '{"translation": "My name is Nemotron."}'],
    ["sends the source back", '{"translation": "What is your name?"}'],
    [
      "explains instead of translating",
      `{"translation": "${"तपाईंको नाम के हो भन्ने प्रश्न हो। ".repeat(12)}"}`,
    ],
    ["replies without JSON", "तपाईंको नाम के हो?"],
    ["replies with an empty translation", '{"translation": "  "}'],
  ])("rejects an answer that %s", async (_label, reply) => {
    await expect(
      adapterFor(new ScriptedClient(reply)).translate(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable", retryable: true });
  });

  it("uses the language the model detected when the source is unknown", async () => {
    const detected = await adapterFor(
      new ScriptedClient('{"translation": "तपाईंको नाम के हो?", "sourceLanguage": "en"}'),
    ).translate({ ...request, sourceLanguage: "auto" }, new AbortController().signal);
    const unreadable = await adapterFor(
      new ScriptedClient('{"translation": "तपाईंको नाम के हो?", "sourceLanguage": "English!"}'),
    ).translate({ ...request, sourceLanguage: "auto" }, new AbortController().signal);

    expect(detected.detectedSourceLanguage).toBe("en");
    expect(unreadable.detectedSourceLanguage).toBeNull();
  });

  it("never sends text without NVIDIA consent", async () => {
    const client = new ScriptedClient('{"translation": "तपाईंको नाम के हो?"}');

    await expect(
      adapterFor(client).translate(
        { ...request, consent: { ...request.consent, nvidia: false } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider-unavailable", retryable: false });
    expect(client.calls).toHaveLength(0);
  });

  it("maps provider failures and a timeout", async () => {
    const rejected = new ScriptedClient(async () => {
      throw Object.assign(new Error("bad key"), { status: 401 });
    });
    const aborted = new ScriptedClient(async () => {
      throw new DOMException("aborted", "AbortError");
    });

    await expect(
      adapterFor(rejected).translate(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable", retryable: false });
    await expect(
      adapterFor(aborted).translate(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("isPlausibleTranslation", () => {
  it("checks the script only for languages that have their own", () => {
    expect(isPlausibleTranslation("Where is the station?", "Où est la gare ?", "fr")).toBe(true);
    expect(isPlausibleTranslation("Where is the station?", "車站在哪裡？", "zh-TW")).toBe(true);
    expect(isPlausibleTranslation("Where is the station?", "Where is it?", "zh-TW")).toBe(false);
  });

  it("allows a brand name inside the target script", () => {
    expect(
      isPlausibleTranslation("Open Google Chrome now.", "अहिले Google Chrome खोल्नुहोस्।", "ne"),
    ).toBe(true);
  });
});

function result(provider: TranslationResult["provider"], text: string): TranslationResult {
  return translationResultSchema.parse({
    detectedSourceLanguage: "en",
    provider,
    requestId: request.requestId,
    targetLanguage: "ne",
    translatedText: text,
    warnings: [],
  });
}

function recording(
  name: string,
  calls: string[],
  behaviour: "fail" | "succeed" | "hang",
  provider: TranslationResult["provider"] = "mymemory",
): TranslationAdapter & { signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  return {
    signals,
    async translate(_request, signal) {
      calls.push(name);
      signals.push(signal);
      if (behaviour === "succeed") return result(provider, name);
      if (behaviour === "fail")
        throw new TranslationAdapterError("provider-unavailable", name, true);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    },
  };
}

describe("translation order", () => {
  it("tries Nemotron, free MyMemory, RapidAPI, then Riva, and stops at the first success", async () => {
    const calls: string[] = [];
    const fallbacks: Array<[string, boolean]> = [];
    const chain = createTranslationChain({
      myMemoryPublic: recording("public", calls, "fail"),
      myMemoryRapidApi: recording("rapidapi", calls, "succeed"),
      nemotron: recording("nemotron", calls, "fail", "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      onFallback: (provider, succeeded) => fallbacks.push([provider, succeeded]),
      riva: recording("riva", calls, "succeed", "nvidia"),
    });

    const translated = await chain.translate(
      { ...request, targetLanguage: "fr" },
      new AbortController().signal,
    );

    expect(translated.translatedText).toBe("rapidapi");
    expect(calls).toEqual(["nemotron", "public", "rapidapi"]);
    expect(fallbacks).toEqual([
      ["mymemory", false],
      ["mymemory", true],
    ]);
  });

  it("serves Nepali from Nemotron and never needs Riva for it", async () => {
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: recording("public", calls, "fail"),
      myMemoryRapidApi: recording("rapidapi", calls, "fail"),
      nemotron: recording("nemotron", calls, "fail", "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      riva: recording("riva", calls, "succeed", "nvidia"),
    });

    await expect(chain.translate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "provider-unavailable",
    });
    // Riva does not support Nepali, so it is skipped rather than asked.
    expect(calls).toEqual(["nemotron", "public", "rapidapi"]);
  });

  it("skips the steps the reader's consent or an unknown source rules out", async () => {
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: recording("public", calls, "succeed"),
      myMemoryRapidApi: null,
      nemotron: recording("nemotron", calls, "succeed", "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      riva: recording("riva", calls, "succeed", "nvidia"),
    });

    const withoutNvidia = await chain.translate(
      { ...request, consent: { ...request.consent, nvidia: false } },
      new AbortController().signal,
    );
    const autoSource = await chain.translate(
      { ...request, sourceLanguage: "auto" },
      new AbortController().signal,
    );

    expect(withoutNvidia.translatedText).toBe("public");
    expect(autoSource.translatedText).toBe("nemotron");
    expect(calls).toEqual(["public", "nemotron"]);
  });

  it("moves on when Nemotron runs past its time limit", async () => {
    const calls: string[] = [];
    const nemotron = recording("nemotron", calls, "hang", "nvidia");
    const chain = createTranslationChain({
      myMemoryPublic: recording("public", calls, "succeed"),
      myMemoryRapidApi: null,
      nemotron,
      nemotronTimeoutMilliseconds: 20,
      riva: recording("riva", calls, "succeed", "nvidia"),
    });

    const translated = await chain.translate(request, new AbortController().signal);

    expect(translated.translatedText).toBe("public");
    expect(nemotron.signals[0]?.aborted).toBe(true);
  });

  it("stops the whole chain when the reader cancels", async () => {
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: recording("public", calls, "succeed"),
      myMemoryRapidApi: null,
      nemotron: recording("nemotron", calls, "hang", "nvidia"),
      nemotronTimeoutMilliseconds: 5_000,
      riva: recording("riva", calls, "succeed", "nvidia"),
    });
    const controller = new AbortController();

    const pending = chain.translate(request, controller.signal);
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual(["nemotron"]);
  });

  it("reports each translator it calls, and how it ended, without the text", async () => {
    const events: TranslationStepEvent[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: recording("public", [], "succeed"),
      myMemoryRapidApi: null,
      nemotron: recording("nemotron", [], "fail", "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      onStep: (event) => events.push(event),
      riva: recording("riva", [], "succeed", "nvidia"),
    });

    await chain.translate(request, new AbortController().signal);

    expect(
      events.map(({ label, outcome, pair, step }) => ({ label, outcome, pair, step })),
    ).toEqual([
      { label: "NVIDIA Nemotron Ultra", outcome: "calling", pair: "en-ne", step: 1 },
      { label: "NVIDIA Nemotron Ultra", outcome: "failed", pair: "en-ne", step: 1 },
      { label: "MyMemory free", outcome: "calling", pair: "en-ne", step: 2 },
      { label: "MyMemory free", outcome: "answered", pair: "en-ne", step: 2 },
    ]);
    expect(events[1]?.reason).toBe("provider-unavailable: nemotron");
    expect(JSON.stringify(events)).not.toContain(request.text);
  });

  it("says no provider can translate when no step accepts the request", async () => {
    const chain = new TranslationProviderChain([
      {
        accepts: () => false,
        adapter: recording("never", [], "succeed"),
        label: "Never",
        metricProvider: "mymemory",
      },
    ]);

    await expect(chain.translate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "provider-unavailable",
      retryable: false,
    });
  });
});
