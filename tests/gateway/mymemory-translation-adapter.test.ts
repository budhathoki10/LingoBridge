import { describe, expect, it } from "vitest";
import {
  createMyMemoryClient,
  type MyMemoryClient,
  type MyMemoryResponse,
  MyMemoryTranslationAdapter,
  splitMyMemorySegments,
} from "../../apps/gateway/src/mymemory-translation-adapter";
import type { TranslationRequest } from "../../packages/contracts/src/index";

const request: TranslationRequest = {
  consent: {
    acceptedAt: "2026-09-16T00:00:00.000Z",
    google: false,
    googleBackup: false,
    myMemory: true,
    nvidia: true,
    nvidiaBackup: true,
    version: "mymemory-primary-nvidia-backup-v1",
  },
  operation: "translate",
  requestId: "c65da980-1ec2-4074-abf7-5f732fe7507d",
  sourceLanguage: "en",
  targetLanguage: "fr",
  text: "Where is the station?",
};

class RecordingClient implements MyMemoryClient {
  calls: Parameters<MyMemoryClient["translate"]>[0][] = [];

  constructor(private readonly response: MyMemoryResponse) {}

  async translate(call: Parameters<MyMemoryClient["translate"]>[0]) {
    this.calls.push(call);
    return this.response;
  }
}

describe("MyMemoryTranslationAdapter", () => {
  it("uses the configured contact email and labels a successful result", async () => {
    const client = new RecordingClient({
      quotaFinished: false,
      responseData: { translatedText: "Ou est la gare ?" },
      responseStatus: 200,
    });
    const adapter = new MyMemoryTranslationAdapter(client, "owner@example.com");

    await expect(adapter.translate(request, new AbortController().signal)).resolves.toMatchObject({
      provider: "mymemory",
      translatedText: "Ou est la gare ?",
    });
    expect(client.calls).toEqual([
      {
        contactEmail: "owner@example.com",
        sourceLanguage: "en",
        targetLanguage: "fr",
        text: request.text,
      },
    ]);
  });

  it("puts q, langpair, de, and mt on every HTTP request", async () => {
    const originalFetch = globalThis.fetch;
    const urls: URL[] = [];
    globalThis.fetch = async (input) => {
      urls.push(new URL(String(input)));
      return new Response(
        JSON.stringify({ responseData: { translatedText: "Bonjour" }, responseStatus: 200 }),
      );
    };
    try {
      const client = createMyMemoryClient("https://api.mymemory.translated.net");
      await client.translate(
        {
          contactEmail: "owner@example.com",
          sourceLanguage: "en",
          targetLanguage: "fr",
          text: "Hello",
        },
        new AbortController().signal,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    const url = urls[0];
    expect(url?.pathname).toBe("/get");
    if (!url) throw new Error("Expected one MyMemory request.");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      de: "owner@example.com",
      langpair: "en|fr",
      mt: "1",
      q: "Hello",
    });
  });

  it("keeps every UTF-8 segment within 500 bytes and preserves line breaks", async () => {
    const text = `${"नमस्ते ".repeat(100)}\n${"word ".repeat(140)}`;
    const segments = splitMyMemorySegments(text);
    expect(segments.length).toBeGreaterThan(2);
    expect(
      segments.every((segment) => new TextEncoder().encode(segment.text).byteLength <= 500),
    ).toBe(true);

    const client = new RecordingClient({
      responseData: { translatedText: "translated" },
      responseStatus: 200,
    });
    const result = await new MyMemoryTranslationAdapter(client, "owner@example.com").translate(
      { ...request, text },
      new AbortController().signal,
    );
    expect(client.calls).toHaveLength(segments.length);
    expect(result.translatedText).toContain("\n");
  });

  it("turns quota, API-status, empty, and auto-language responses into safe failures", async () => {
    for (const response of [
      { quotaFinished: true, responseData: { translatedText: "ignored" }, responseStatus: 200 },
      { responseData: { translatedText: "ignored" }, responseStatus: 403 },
      { responseData: { translatedText: "" }, responseStatus: 200 },
    ]) {
      await expect(
        new MyMemoryTranslationAdapter(
          new RecordingClient(response),
          "owner@example.com",
        ).translate(request, new AbortController().signal),
      ).rejects.toMatchObject({ code: "provider-unavailable" });
    }
    await expect(
      new MyMemoryTranslationAdapter(
        new RecordingClient({ responseData: { translatedText: "ignored" }, responseStatus: 200 }),
        "owner@example.com",
      ).translate({ ...request, sourceLanguage: "auto" }, new AbortController().signal),
    ).rejects.toMatchObject({ retryable: false });
  });
});
