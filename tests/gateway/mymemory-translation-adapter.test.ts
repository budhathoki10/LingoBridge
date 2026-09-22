import { describe, expect, it } from "vitest";
import {
  createMyMemoryClient,
  type MyMemoryClient,
  type MyMemoryFailure,
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

  it("sends the private Translation Memory key as `key` only when configured", async () => {
    const originalFetch = globalThis.fetch;
    const urls: URL[] = [];
    globalThis.fetch = async (input) => {
      urls.push(new URL(String(input)));
      return new Response(
        JSON.stringify({ responseData: { translatedText: "Bonjour" }, responseStatus: 200 }),
      );
    };
    const call = {
      contactEmail: "owner@example.com",
      sourceLanguage: "en",
      targetLanguage: "fr",
      text: "Hello",
    };
    try {
      await createMyMemoryClient("https://api.mymemory.translated.net", {
        privateKey: "private-tm-key",
      }).translate(call, new AbortController().signal);
      await createMyMemoryClient("https://api.mymemory.translated.net").translate(
        call,
        new AbortController().signal,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(urls[0]?.searchParams.get("key")).toBe("private-tm-key");
    expect(urls[1]?.searchParams.has("key")).toBe(false);
  });

  it("sends RapidAPI credentials to the RapidAPI host when a key is configured", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ headers: Headers; url: URL }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ headers: new Headers(init?.headers), url: new URL(String(input)) });
      return new Response(
        JSON.stringify({ responseData: { translatedText: "Bonjour" }, responseStatus: 200 }),
        { headers: { "Retry-After": "71283" } },
      );
    };
    try {
      const client = createMyMemoryClient("https://api.mymemory.translated.net", {
        rapidApiHost: "mymemory-translation-memory1.p.rapidapi.com",
        rapidApiKey: "rapid-key",
      });
      const response = await client.translate(
        {
          contactEmail: "owner@example.com",
          sourceLanguage: "en",
          targetLanguage: "fr",
          text: "Hello",
        },
        new AbortController().signal,
      );
      expect(response.retryAfterSeconds).toBe(71283);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const call = calls[0];
    if (!call) throw new Error("Expected one MyMemory request.");
    expect(call.url.host).toBe("mymemory-translation-memory1.p.rapidapi.com");
    expect(call.url.pathname).toBe("/get");
    expect(call.headers.get("X-RapidAPI-Key")).toBe("rapid-key");
    expect(call.headers.get("X-RapidAPI-Host")).toBe("mymemory-translation-memory1.p.rapidapi.com");
    // The contact email still goes out, so the consent disclosure stays accurate.
    expect(call.url.searchParams.get("de")).toBe("owner@example.com");
  });

  it("keeps using the public endpoint when no RapidAPI key is configured", async () => {
    const originalFetch = globalThis.fetch;
    const urls: URL[] = [];
    globalThis.fetch = async (input, init) => {
      urls.push(new URL(String(input)));
      expect(new Headers(init?.headers).get("X-RapidAPI-Key")).toBeNull();
      return new Response(
        JSON.stringify({ responseData: { translatedText: "Bonjour" }, responseStatus: 200 }),
      );
    };
    try {
      await createMyMemoryClient("https://api.mymemory.translated.net", {
        rapidApiHost: "mymemory-translation-memory1.p.rapidapi.com",
        rapidApiKey: "   ",
      }).translate(
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
    expect(urls[0]?.host).toBe("api.mymemory.translated.net");
  });

  it("reports quota exhaustion and rejection as distinct, content-free failures", async () => {
    const failures: MyMemoryFailure[] = [];
    const record = (failure: MyMemoryFailure) => failures.push(failure);

    await expect(
      new MyMemoryTranslationAdapter(
        new RecordingClient({
          quotaFinished: true,
          responseDetails: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY",
          responseStatus: 200,
          retryAfterSeconds: 71283,
        }),
        "owner@example.com",
        record,
      ).translate(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable" });

    await expect(
      new MyMemoryTranslationAdapter(
        new RecordingClient({
          responseDetails: "INVALID EMAIL PROVIDED",
          responseStatus: "403",
        }),
        "owner@example.com",
        record,
      ).translate(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable" });

    expect(failures).toMatchObject([
      { outcome: "quota-exhausted", quotaFinished: true, retryAfterSeconds: 71283 },
      { outcome: "rejected", detail: "INVALID EMAIL PROVIDED", responseStatus: "403" },
    ]);
    // Nothing logged may carry the text that was being translated.
    expect(JSON.stringify(failures)).not.toContain(request.text);
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
