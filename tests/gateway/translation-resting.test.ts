import { describe, expect, it } from "vitest";
import { MyMemoryTranslationAdapter } from "../../apps/gateway/src/mymemory-translation-adapter";
import { NemotronTranslationAdapter } from "../../apps/gateway/src/nemotron-translation-adapter";
import type {
  NvidiaChatCompletionResponse,
  NvidiaTranslationClient,
} from "../../apps/gateway/src/nvidia-translation-adapter";
import {
  createTranslationChain,
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
  requestId: "5b1c2d3e-4f50-4a61-8b72-9c83d4e5f601",
  sourceLanguage: "en",
  targetLanguage: "ne",
  text: "Good morning",
};

function answer(provider: TranslationResult["provider"]): TranslationResult {
  return translationResultSchema.parse({
    detectedSourceLanguage: "en",
    provider,
    requestId: request.requestId,
    targetLanguage: "ne",
    translatedText: "शुभ प्रभात",
    warnings: [],
  });
}

/** A translator that records each call and behaves as `behaviour()` says at call time. */
function scripted(
  name: string,
  calls: string[],
  behaviour: () => "succeed" | "hang" | Error,
  provider: TranslationResult["provider"] = "mymemory",
): TranslationAdapter {
  return {
    async translate(_request, signal) {
      calls.push(name);
      const next = behaviour();
      if (next === "succeed") return answer(provider);
      if (next === "hang") {
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            {
              once: true,
            },
          );
        });
      }
      throw next;
    },
  };
}

const limited = (seconds: number | null) =>
  new TranslationAdapterError("provider-unavailable", "rate limited", true, {
    kind: "limited",
    retryAfterSeconds: seconds,
  });
const outage = () => new TranslationAdapterError("timeout", "timed out");
const badAnswer = () => new TranslationAdapterError("provider-unavailable", "unusable answer");
const count = (calls: string[], name: string) => calls.filter((call) => call === name).length;

describe("resting translators that hit a limit", () => {
  it("skips a rate-limited step until its wait is over, then calls it again", async () => {
    let clock = 0;
    let nemotronLimited = true;
    const calls: string[] = [];
    const events: TranslationStepEvent[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: scripted("public", calls, () => "succeed"),
      myMemoryRapidApi: null,
      nemotron: scripted(
        "nemotron",
        calls,
        () => (nemotronLimited ? limited(30) : "succeed"),
        "nvidia",
      ),
      nemotronTimeoutMilliseconds: 1_000,
      now: () => clock,
      onStep: (event) => events.push(event),
      riva: scripted("riva", calls, () => "succeed", "nvidia"),
    });

    await chain.translate(request, new AbortController().signal);
    clock += 10_000;
    await chain.translate(request, new AbortController().signal);

    expect(calls).toEqual(["nemotron", "public", "public"]);
    expect(events.find((event) => event.outcome === "failed")?.restSeconds).toBe(30);
    expect(events.find((event) => event.outcome === "skipped")).toMatchObject({
      label: "NVIDIA Nemotron Ultra",
      reason: "rate limited",
      restSeconds: 20,
    });

    nemotronLimited = false;
    clock += 20_000;
    const back = await chain.translate(request, new AbortController().signal);
    expect(calls.at(-1)).toBe("nemotron");
    expect(back.provider).toBe("nvidia");
  });

  it("rests a limit that names no wait for one minute", async () => {
    let clock = 0;
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: scripted("public", calls, () => "succeed"),
      myMemoryRapidApi: null,
      nemotron: scripted("nemotron", calls, () => limited(null), "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      now: () => clock,
      riva: scripted("riva", calls, () => "succeed", "nvidia"),
    });
    const send = () => chain.translate(request, new AbortController().signal);

    await send();
    clock += 59_000;
    await send();
    clock += 1_000;
    await send();

    expect(calls).toEqual(["nemotron", "public", "public", "nemotron", "public"]);
  });

  it("rests a step after three outages in a row, and a success clears the count", async () => {
    let clock = 0;
    let healthy = false;
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: scripted("public", calls, () => "succeed"),
      myMemoryRapidApi: null,
      nemotron: scripted("nemotron", calls, () => (healthy ? "succeed" : outage()), "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      now: () => clock,
      riva: scripted("riva", calls, () => "succeed", "nvidia"),
    });
    const send = () => chain.translate(request, new AbortController().signal);

    await send();
    await send();
    healthy = true;
    await send();
    healthy = false;
    await send();
    await send();
    // Two outages, a success, then two more: never three in a row, so never rested.
    expect(count(calls, "nemotron")).toBe(5);

    await send();
    await send();
    // The third outage in a row rests it; the next request skips it.
    expect(count(calls, "nemotron")).toBe(6);

    clock += 2 * 60 * 1_000;
    await send();
    expect(count(calls, "nemotron")).toBe(7);
  });

  it("never rests a step for a failure that only concerns one request", async () => {
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: scripted("public", calls, () => "succeed"),
      myMemoryRapidApi: null,
      nemotron: scripted("nemotron", calls, badAnswer, "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      riva: scripted("riva", calls, () => "succeed", "nvidia"),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await chain.translate(request, new AbortController().signal);
    }

    expect(count(calls, "nemotron")).toBe(5);
  });

  it("answers with a retryable error, calling nothing, when every translator is resting", async () => {
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: scripted("public", calls, () => limited(3_600)),
      myMemoryRapidApi: scripted("rapidapi", calls, () => limited(60)),
      nemotron: scripted("nemotron", calls, () => limited(60), "nvidia"),
      nemotronTimeoutMilliseconds: 1_000,
      now: () => 0,
      riva: scripted("riva", calls, () => "succeed", "nvidia"),
    });

    await expect(chain.translate(request, new AbortController().signal)).rejects.toBeDefined();
    calls.length = 0;

    await expect(chain.translate(request, new AbortController().signal)).rejects.toMatchObject({
      message: "Every translator is resting after hitting its limit. Try again shortly.",
      retryable: true,
    });
    expect(calls).toEqual([]);
  });

  it("does not rest a step because the reader cancelled", async () => {
    const calls: string[] = [];
    const chain = createTranslationChain({
      myMemoryPublic: scripted("public", calls, () => "succeed"),
      myMemoryRapidApi: null,
      nemotron: scripted("nemotron", calls, () => "hang", "nvidia"),
      nemotronTimeoutMilliseconds: 60_000,
      riva: scripted("riva", calls, () => "succeed", "nvidia"),
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const controller = new AbortController();
      const pending = chain.translate(request, controller.signal);
      setTimeout(() => controller.abort(), 5);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    }

    // Four cancellations later, Nemotron is still asked first.
    expect(calls).toEqual(["nemotron", "nemotron", "nemotron", "nemotron"]);
  });
});

class FailingNvidiaClient implements NvidiaTranslationClient {
  constructor(private readonly error: Error) {}
  async createChatCompletion(): Promise<NvidiaChatCompletionResponse> {
    throw this.error;
  }
}

const nemotronWith = (client: NvidiaTranslationClient) =>
  new NemotronTranslationAdapter(client, "nvidia/nemotron-3-ultra-550b-a55b", 4_096);

describe("how each translator labels its failures", () => {
  it("marks an NVIDIA 429 as a limit with NVIDIA's own wait", async () => {
    const client = new FailingNvidiaClient(
      Object.assign(new Error("slow down"), { retryAfterSeconds: 12, status: 429 }),
    );

    await expect(
      nemotronWith(client).translate(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "limited", retryAfterSeconds: 12 });
  });

  it("marks an NVIDIA server error as an outage", async () => {
    const client = new FailingNvidiaClient(Object.assign(new Error("down"), { status: 503 }));

    await expect(
      nemotronWith(client).translate(request, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "outage" });
  });

  it("marks MyMemory's exhausted daily quota as a limit, resting an hour by default", async () => {
    const adapter = new MyMemoryTranslationAdapter(
      {
        async translate() {
          return {
            quotaFinished: true,
            responseData: {
              translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS",
            },
            responseStatus: 429,
          };
        },
      },
      "contact@example.com",
    );

    await expect(adapter.translate(request, new AbortController().signal)).rejects.toMatchObject({
      kind: "limited",
      message: "MyMemory daily quota is exhausted.",
      retryAfterSeconds: 3_600,
    });
  });

  it("marks a MyMemory HTTP 429 as a limit with its Retry-After", async () => {
    const adapter = new MyMemoryTranslationAdapter(
      {
        async translate() {
          throw Object.assign(new Error("too many"), { retryAfterSeconds: 90, status: 429 });
        },
      },
      "contact@example.com",
    );

    await expect(adapter.translate(request, new AbortController().signal)).rejects.toMatchObject({
      kind: "limited",
      retryAfterSeconds: 90,
    });
  });
});
