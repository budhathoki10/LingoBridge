import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PreviewProviderError,
  type PreviewTranslationRequest,
  translateWithPreviewData,
} from "../../apps/extension/lib/fake-provider";

const request: PreviewTranslationRequest = {
  attempt: 1,
  requestId: 1,
  sourceLanguage: "auto",
  targetLanguage: "ne",
  targetLanguageName: "नेपाली",
  targetTextDirection: "ltr",
  text: "Hello, how are you?",
};

describe("deterministic preview provider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the same labelled preview result for the same request", async () => {
    const first = translateWithPreviewData(request, new AbortController().signal);
    await vi.runAllTimersAsync();
    const firstResult = await first;

    const second = translateWithPreviewData(request, new AbortController().signal);
    await vi.runAllTimersAsync();
    const secondResult = await second;

    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toMatchObject({
      detectedSourceLanguage: "en",
      provider: "preview",
      translatedText: "नमस्ते, तपाईंलाई कस्तो छ?",
    });
  });

  it("can be cancelled without returning a result", async () => {
    const controller = new AbortController();
    const result = translateWithPreviewData(request, controller.signal);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails once for the retry fixture and succeeds on the next attempt", async () => {
    const failingRequest = { ...request, text: "simulate failure" };
    const first = translateWithPreviewData(failingRequest, new AbortController().signal);
    const firstExpectation = expect(first).rejects.toBeInstanceOf(PreviewProviderError);
    await vi.runAllTimersAsync();
    await firstExpectation;

    const retry = translateWithPreviewData(
      { ...failingRequest, attempt: 2, requestId: 2 },
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();

    await expect(retry).resolves.toMatchObject({ requestId: 2, provider: "preview" });
  });
});
