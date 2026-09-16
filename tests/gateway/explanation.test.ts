import { describe, expect, it } from "vitest";
import { createGatewayApp } from "../../apps/gateway/src/app";
import { loadGatewayRuntimeConfig } from "../../apps/gateway/src/config";
import type { ExplanationAdapter } from "../../apps/gateway/src/explanation-adapter";
import { FakeExplanationAdapter } from "../../apps/gateway/src/fake-explanation-adapter";
import { FakeTranslationAdapter } from "../../apps/gateway/src/fake-translation-adapter";
import {
  DEFAULT_EXPLANATION_MODEL,
  describeLanguage,
  EXPLANATION_SYSTEM_PROMPT,
  extractJsonObject,
  looksLikeRestatement,
  normalizeDigits,
  NvidiaExplanationAdapter,
  SIMPLER_WORDS_NUDGE,
  truncateField,
  WORD_JSON_NUDGE,
  WORD_UNDERSTANDING_SYSTEM_PROMPT,
} from "../../apps/gateway/src/nvidia-explanation-adapter";
import type {
  NvidiaChatCompletionRequest,
  NvidiaChatCompletionResponse,
  NvidiaTranslationClient,
} from "../../apps/gateway/src/nvidia-translation-adapter";
import { TranslationAdapterError } from "../../apps/gateway/src/translation-adapter";
import {
  ANONYMOUS_INSTALLATION_HEADER,
  type ExplanationRequest,
  explanationResultSchema,
  GATEWAY_ROUTES,
  MAX_EXPLANATION_SOURCE_CODE_POINTS,
  translationErrorSchema,
  type WordUnderstandingRequest,
  wordUnderstandingResultSchema,
} from "../../packages/contracts/src/index";

const explanationRequest: ExplanationRequest = {
  consent: {
    acceptedAt: "2026-09-15T00:00:00.000Z",
    nvidia: true,
    version: "explain-nvidia-nemotron-v1",
  },
  operation: "explain",
  requestId: "0b8d9c1e-6f7a-4d3b-9e2c-5a1b7c8d9e0f",
  sourceLanguage: "en",
  sourceText: "break a leg",
  targetLanguage: "ja",
  translatedText: "足を折って",
};

const headers = {
  "Content-Type": "application/json",
  [ANONYMOUS_INSTALLATION_HEADER]: "1fb7891e-277d-4cba-aaf9-f7d33703f67e",
};

function post(app: ReturnType<typeof createGatewayApp>, body: unknown) {
  return app.request(GATEWAY_ROUTES.explain, {
    body: JSON.stringify(body),
    headers,
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

describe("explain route", () => {
  it("returns a contract-valid explanation for a consented, short phrase", async () => {
    const response = await post(testApp(), explanationRequest);
    expect(response.status).toBe(200);
    const result = explanationResultSchema.parse(await response.json());
    expect(result.requestId).toBe(explanationRequest.requestId);
    expect(result.provider).toBe("nvidia");
  });

  it("says explanations are not set up when no provider is configured", async () => {
    const response = await post(testApp(null), explanationRequest);
    expect(response.status).toBe(503);
    expect(translationErrorSchema.parse(await response.json())).toMatchObject({
      code: "provider-unavailable",
      message: "Explanations are not set up on this gateway yet.",
      retryable: false,
    });
  });

  it("refuses requests without explanation consent or with passages that are too long", async () => {
    const app = testApp();
    const { consent: _consent, ...withoutConsent } = explanationRequest;
    expect((await post(app, withoutConsent)).status).toBe(400);
    expect(
      (
        await post(app, {
          ...explanationRequest,
          consent: { ...explanationRequest.consent, nvidia: false },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(app, {
          ...explanationRequest,
          sourceText: "a".repeat(MAX_EXPLANATION_SOURCE_CODE_POINTS + 1),
        })
      ).status,
    ).toBe(400);
  });

  it("maps provider failures to retryable errors without exposing the text", async () => {
    const response = await post(testApp(), {
      ...explanationRequest,
      sourceText: "simulate failure",
    });
    expect(response.status).toBe(503);
    const error = translationErrorSchema.parse(await response.json());
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("simulate failure");
  });

  it("defaults to Nemotron 3 Ultra with a longer deadline, and validates the model ID", () => {
    const config = loadGatewayRuntimeConfig({});
    expect(config.explanationModel).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(DEFAULT_EXPLANATION_MODEL).toBe(config.explanationModel);
    expect(config.explanationTimeoutMilliseconds).toBe(90_000);
    expect(() => loadGatewayRuntimeConfig({ NVIDIA_EXPLANATION_MODEL: "not a model" })).toThrow();
  });

  it("configures the OpenRouter backup only in live mode", () => {
    const fake = loadGatewayRuntimeConfig({ OPENROUTER_API_KEY: "or-key" });
    expect(fake.openRouterApiKey).toBeNull();
    expect(fake.openRouterModel).toBe("nex-agi/nex-n2.5-pro:free");
    expect(fake.openRouterBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(fake.explanationPrimaryTimeoutMilliseconds).toBe(20_000);

    const live = loadGatewayRuntimeConfig({
      LINGOBRIDGE_ALLOWED_EXTENSION_ORIGINS: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      LINGOBRIDGE_TRANSLATION_MODE: "live",
      MYMEMORY_CONTACT_EMAIL: "owner@example.com",
      NVIDIA_API_KEY: "nv-key",
      OPENROUTER_API_KEY: " or-key ",
      OPENROUTER_MODEL: "google/gemma-4-26b-a4b-it:free",
    });
    expect(live.openRouterApiKey).toBe("or-key");
    expect(live.openRouterModel).toBe("google/gemma-4-26b-a4b-it:free");
    expect(() => loadGatewayRuntimeConfig({ OPENROUTER_MODEL: "gemma free" })).toThrow(
      "OPENROUTER_MODEL",
    );
  });
});

describe("word-understanding route", () => {
  it("returns structured context for one explicitly requested word", async () => {
    const request: WordUnderstandingRequest = {
      ...explanationRequest,
      operation: "understand-word",
      sourceText: "The team completed the deployment yesterday.",
      translatedText: "टोलीले हिजो परिनियोजन पूरा गर्यो।",
      targetLanguage: "ne",
      word: "deployment",
    };
    const response = await testApp().request(GATEWAY_ROUTES.understandWord, {
      body: JSON.stringify(request),
      headers,
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(wordUnderstandingResultSchema.parse(await response.json())).toMatchObject({
      provider: "nvidia",
      word: "deployment",
    });
  });
});

class RecordingNvidiaClient implements NvidiaTranslationClient {
  calls: NvidiaChatCompletionRequest[] = [];

  constructor(private readonly respond: (call: number) => NvidiaChatCompletionResponse) {}

  async createChatCompletion(request: NvidiaChatCompletionRequest) {
    this.calls.push(structuredClone(request));
    return this.respond(this.calls.length);
  }
}

function reply(content: string): () => NvidiaChatCompletionResponse {
  return () => ({ choices: [{ message: { content } }] });
}

const modelAnswer = {
  examples: [
    { source: "Break a leg tonight!", translation: "今夜、がんばってね！" },
    { source: "They told me to break a leg.", translation: "みんなが私に「がんばって」と言った。" },
    { source: "A third example.", translation: "三つ目の例。" },
  ],
  meaning: "「がんばって」という応援の言葉です。本当に足を折るという意味ではありません。",
  register: "casual",
  usageNote: "   ",
};

describe("NvidiaExplanationAdapter", () => {
  it("asks for the explanation in the translated language and maps the JSON answer", async () => {
    const client = new RecordingNvidiaClient(reply(JSON.stringify(modelAnswer)));
    const adapter = new NvidiaExplanationAdapter(client, DEFAULT_EXPLANATION_MODEL, 1_500);
    const result = await adapter.explain(explanationRequest, new AbortController().signal);

    expect(result).toEqual({
      examples: modelAnswer.examples.slice(0, 1),
      meaning: modelAnswer.meaning,
      provider: "nvidia",
      register: "casual",
      requestId: explanationRequest.requestId,
      usageNote: null,
    });

    const call = client.calls[0];
    expect(call?.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(call?.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(call?.max_tokens).toBe(1_500);
    expect(call?.messages[0]).toEqual({ content: EXPLANATION_SYSTEM_PROMPT, role: "system" });
    expect(call?.messages[1]?.content).toContain("Reader's language: Japanese (ja)");
    expect(call?.messages[1]?.content).toContain("Source language: English (en)");
    expect(call?.messages[1]?.content).toContain("<selected_text>break a leg</selected_text>");
  });

  it("fixes numbers Nemotron partly transliterated into Devanagari digits", async () => {
    const numberRequest = {
      ...explanationRequest,
      sourceText: "You can translate about 830 to 1,000 words per day",
      targetLanguage: "ne",
      translatedText: "तपाईं प्रति दिन लगभग ८३० देखि १,००० शब्दहरू अनुवाद गर्न सक्नुहुन्छ",
    };
    const answer = {
      ...modelAnswer,
      meaning: "यो भन्छ कि एक दिनमा कति शब्द अनुवाद गर्न सकिन्छ।",
      examples: [
        {
          source:
            "The project manager said you can translate about 830 to 1,000 words per day, so we have two weeks for this 15,000-word job.",
          translation:
            "प्रोजेक्ट म्यानेजरले भनेका छन् कि तपाईं प्रति दिन ८३० देखि १,000 शब्द अनुवाद गर्न सक्नुहुन्छ, त्यसैले हामीसँग यो १५,000 शब्दको कामका लागि दुई हप्ता छन्।",
        },
      ],
    };
    const result = await new NvidiaExplanationAdapter(
      new RecordingNvidiaClient(reply(JSON.stringify(answer))),
    ).explain(numberRequest, new AbortController().signal);

    expect(result.examples[0]?.translation).not.toMatch(/[०-९]/u);
    expect(result.examples[0]?.translation).toContain("830 देखि 1,000");
    expect(result.examples[0]?.translation).toContain("15,000 शब्दको");
  });

  it("drops a repeated translation pair and keeps one contextual example", async () => {
    const sentenceRequest = {
      ...explanationRequest,
      sourceText: "A cow is a large domesticated mammal.",
      targetLanguage: "ne",
      translatedText: "गाई ठूलो घरपालुवा स्तनपायी जनावर हो।",
    };
    const answer = {
      ...modelAnswer,
      examples: [
        {
          source: "A cow is a large domesticated mammal.",
          translation: "गाई ठूलो घरपालुवा स्तनपायी जनावर हो।",
        },
        {
          source: "The textbook says that a cow is a large domesticated mammal.",
          translation: "पाठ्यपुस्तकमा भनिएको छ कि गाई ठूलो घरपालुवा स्तनपायी जनावर हो।",
        },
      ],
    };
    const result = await new NvidiaExplanationAdapter(
      new RecordingNvidiaClient(reply(JSON.stringify(answer))),
    ).explain(sentenceRequest, new AbortController().signal);

    expect(result.examples).toEqual([answer.examples[1]]);
  });

  it("asks once more for simpler words when the meaning only repeats the translation", async () => {
    const copied = { ...modelAnswer, meaning: "足を折って、という意味です。" };
    const client = new RecordingNvidiaClient((call) =>
      reply(JSON.stringify(call === 1 ? copied : modelAnswer))(),
    );
    const result = await new NvidiaExplanationAdapter(client).explain(
      explanationRequest,
      new AbortController().signal,
    );

    expect(result.meaning).toBe(modelAnswer.meaning);
    expect(client.calls).toHaveLength(2);
    const retry = client.calls[1]?.messages ?? [];
    expect(retry.at(-2)).toEqual({ content: JSON.stringify(copied), role: "assistant" });
    expect(retry.at(-1)).toEqual({ content: SIMPLER_WORDS_NUDGE, role: "user" });
  });

  it("does not retry a real explanation, and keeps the first answer if the rewrite is unusable", async () => {
    const fine = new RecordingNvidiaClient(reply(JSON.stringify(modelAnswer)));
    await new NvidiaExplanationAdapter(fine).explain(
      explanationRequest,
      new AbortController().signal,
    );
    expect(fine.calls).toHaveLength(1);

    const copied = { ...modelAnswer, meaning: "足を折って" };
    const broken = new RecordingNvidiaClient((call) =>
      reply(call === 1 ? JSON.stringify(copied) : "not json")(),
    );
    const result = await new NvidiaExplanationAdapter(broken).explain(
      explanationRequest,
      new AbortController().signal,
    );
    expect(result.meaning).toBe("足を折って");
    expect(broken.calls).toHaveLength(2);

    expect(looksLikeRestatement("足を折って", "足を折って")).toBe(true);
    expect(looksLikeRestatement("足を折って、という意味です。", "足を折って")).toBe(true);
    expect(looksLikeRestatement(modelAnswer.meaning, "足を折って")).toBe(false);
    const arabic = "أخبر الأصدقاء والعائلة وزملاء العمل السابقين بما قمت بإنشائه";
    expect(looksLikeRestatement(arabic, arabic)).toBe(true);
    expect(
      looksLikeRestatement("يقول النص إن أول زبائنك يأتون غالبا من الناس الذين تعرفهم.", arabic),
    ).toBe(false);
  });

  it("reads JSON wrapped in a thinking block or a code fence", async () => {
    const wrapped = `<think>The reader wants Japanese.</think>\n\`\`\`json\n${JSON.stringify(modelAnswer)}\n\`\`\``;
    const adapter = new NvidiaExplanationAdapter(new RecordingNvidiaClient(reply(wrapped)));
    const result = await adapter.explain(explanationRequest, new AbortController().signal);
    expect(result.meaning).toBe(modelAnswer.meaning);
    expect(extractJsonObject("no json here")).toBeNull();
    expect(describeLanguage("ne")).toBe("Nepali (ne)");
  });

  it("treats unreadable answers as retryable and client errors as final", async () => {
    const unreadable = new NvidiaExplanationAdapter(
      new RecordingNvidiaClient(reply("Sorry, I cannot help with that.")),
    );
    await expect(
      unreadable.explain(explanationRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable", retryable: true });

    const rejected = new NvidiaExplanationAdapter(
      new RecordingNvidiaClient(() => {
        throw Object.assign(new Error("bad request"), { status: 400 });
      }),
    );
    await expect(
      rejected.explain(explanationRequest, new AbortController().signal),
    ).rejects.toMatchObject({ retryable: false });

    const busy = new NvidiaExplanationAdapter(
      new RecordingNvidiaClient(() => {
        throw Object.assign(new Error("busy"), { status: 429 });
      }),
    );
    await expect(
      busy.explain(explanationRequest, new AbortController().signal),
    ).rejects.toBeInstanceOf(TranslationAdapterError);
  });
});

describe("NvidiaExplanationAdapter.understandWord", () => {
  const wordRequest: WordUnderstandingRequest = {
    ...explanationRequest,
    operation: "understand-word",
    sourceLanguage: "en",
    sourceText: "Cows drink an enormous amount of water every day.",
    targetLanguage: "ne",
    translatedText: "गाईहरूले हरेक दिन ठूलो मात्रामा पानी पिउँछन्।",
    word: "enormous",
  };
  const wordAnswer = {
    contextMeaning: "यहाँ पानीको मात्रा धेरै ठूलो भएको बुझाउँछ।",
    example: "The project needed an enormous amount of money.",
    meaning: "अत्यधिक ठूलो",
    partOfSpeech: "adjective",
    pronunciation: "/ɪˈnɔːrməs/",
    translation: "विशाल",
    word: "enormous",
  };

  it("asks once more when the first answer is not readable JSON", async () => {
    const client = new RecordingNvidiaClient((call) =>
      reply(call === 1 ? "Sure! Here is the meaning of enormous." : JSON.stringify(wordAnswer))(),
    );
    const result = await new NvidiaExplanationAdapter(client).understandWord(
      wordRequest,
      new AbortController().signal,
    );

    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.messages.at(-1)).toEqual({ content: WORD_JSON_NUDGE, role: "user" });
    expect(result).toMatchObject({ translation: "विशाल", word: "enormous" });
  });

  it("retries once when NVIDIA is briefly unavailable", async () => {
    const client = new RecordingNvidiaClient((call) => {
      if (call === 1) throw Object.assign(new Error("overloaded"), { status: 503 });
      return reply(JSON.stringify(wordAnswer))();
    });
    const result = await new NvidiaExplanationAdapter(
      client,
      DEFAULT_EXPLANATION_MODEL,
      2_048,
      0,
    ).understandWord(wordRequest, new AbortController().signal);

    expect(client.calls).toHaveLength(2);
    expect(result.translation).toBe("विशाल");
  });

  it("does not retry a request NVIDIA rejected", async () => {
    const client = new RecordingNvidiaClient(() => {
      throw Object.assign(new Error("bad request"), { status: 400 });
    });
    await expect(
      new NvidiaExplanationAdapter(client, DEFAULT_EXPLANATION_MODEL, 2_048, 0).understandWord(
        wordRequest,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ retryable: false });
    expect(client.calls).toHaveLength(1);
  });

  it("gives up after the single retry when NVIDIA stays unavailable", async () => {
    const client = new RecordingNvidiaClient(() => {
      throw Object.assign(new Error("overloaded"), { status: 503 });
    });
    await expect(
      new NvidiaExplanationAdapter(client, DEFAULT_EXPLANATION_MODEL, 2_048, 0).understandWord(
        wordRequest,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider-unavailable", retryable: true });
    expect(client.calls).toHaveLength(2);
  });

  it("fails as retryable when both answers are unreadable", async () => {
    const client = new RecordingNvidiaClient(reply("not json"));
    await expect(
      new NvidiaExplanationAdapter(client).understandWord(
        wordRequest,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider-unavailable", retryable: true });
    expect(client.calls).toHaveLength(2);
  });

  it("trims overlong fields to the contract instead of rejecting the answer", async () => {
    const verbose = {
      ...wordAnswer,
      example: "e".repeat(400),
      partOfSpeech: "adjective (describes an extremely large size or quantity)",
      pronunciation: "   ",
    };
    const client = new RecordingNvidiaClient(reply(JSON.stringify(verbose)));
    const result = await new NvidiaExplanationAdapter(client).understandWord(
      wordRequest,
      new AbortController().signal,
    );

    expect(client.calls).toHaveLength(1);
    expect(wordUnderstandingResultSchema.safeParse(result).success).toBe(true);
    expect(result.partOfSpeech).toBe("adjective (describes an extremely large");
    expect(result.example).toHaveLength(300);
    expect(result.pronunciation).toBeNull();
  });

  it("asks for every word field in the reader's language", async () => {
    const client = new RecordingNvidiaClient(reply(JSON.stringify(wordAnswer)));
    await new NvidiaExplanationAdapter(client).understandWord(
      wordRequest,
      new AbortController().signal,
    );
    expect(client.calls[0]?.messages[0]?.content).toContain(
      'Write every field except "word" entirely in the reader\'s language.',
    );
    expect(client.calls[0]?.messages[1]?.content).toContain("Reader's language: Nepali (ne)");
  });

  it("asks for the selected word's pronunciation, not the translation's", async () => {
    expect(WORD_UNDERSTANDING_SYSTEM_PROMPT).toContain(
      "how to say the selected source-language word itself",
    );
    expect(WORD_UNDERSTANDING_SYSTEM_PROMPT).toContain('Nepali "इनोर्मस"');
  });

  it("drops a pronunciation that only repeats the translation", async () => {
    const echo = new RecordingNvidiaClient(
      reply(JSON.stringify({ ...wordAnswer, pronunciation: " विशाल ", translation: "विशाल" })),
    );
    const echoed = await new NvidiaExplanationAdapter(echo).understandWord(
      wordRequest,
      new AbortController().signal,
    );
    expect(echoed.pronunciation).toBeNull();

    const spoken = new RecordingNvidiaClient(
      reply(JSON.stringify({ ...wordAnswer, pronunciation: "इनोर्मस", translation: "विशाल" })),
    );
    const kept = await new NvidiaExplanationAdapter(spoken).understandWord(
      wordRequest,
      new AbortController().signal,
    );
    expect(kept.pronunciation).toBe("इनोर्मस");
  });

  it("returns word-understanding numbers in plain digits", async () => {
    const client = new RecordingNvidiaClient(
      reply(
        JSON.stringify({
          ...wordAnswer,
          contextMeaning: "लगभग ३० देखि ५० ग्यालन पानी।",
          example: "गाईले दिनमा ३० लिटर पानी पिउँछ।",
        }),
      ),
    );
    const result = await new NvidiaExplanationAdapter(client).understandWord(
      wordRequest,
      new AbortController().signal,
    );
    expect(result.contextMeaning).toBe(normalizeDigits("लगभग ३० देखि ५० ग्यालन पानी।"));
    expect(result.contextMeaning).toContain("30 देखि 50");
    expect(result.example).toBe("गाईले दिनमा 30 लिटर पानी पिउँछ।");
  });

  it("keeps multi-byte characters whole when truncating", () => {
    expect(truncateField("विशाल विशाल", 5)).toBe("विशाल".slice(0, 5));
    expect(truncateField("  😀😀😀  ", 2)).toBe("😀😀");
  });
});
