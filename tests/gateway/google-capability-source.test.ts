import { describe, expect, it } from "vitest";
import { GoogleCapabilitySource } from "../../apps/gateway/src/google-capability-source";
import type {
  GoogleCapabilityClient,
  GoogleSupportedLanguagesRequest,
  GoogleSupportedLanguagesResponse,
} from "../../apps/gateway/src/google-translation-adapter";

class RecordingCapabilityClient implements GoogleCapabilityClient {
  calls: Array<{ request: GoogleSupportedLanguagesRequest; timeoutMilliseconds: number }> = [];

  constructor(private readonly response: GoogleSupportedLanguagesResponse) {}

  async getSupportedLanguages(
    request: GoogleSupportedLanguagesRequest,
    timeoutMilliseconds: number,
  ) {
    this.calls.push({ request, timeoutMilliseconds });
    return this.response;
  }
}

const googleResponse: GoogleSupportedLanguagesResponse = {
  languages: [
    { displayName: "Nepali", languageCode: "ne", supportSource: true, supportTarget: true },
    { displayName: "Arabic", languageCode: "ar", supportSource: true, supportTarget: true },
    { displayName: "English", languageCode: "en", supportSource: true, supportTarget: true },
  ],
};

describe("GoogleCapabilitySource", () => {
  it("requests general NMT languages and creates a compact normalized catalogue", async () => {
    const client = new RecordingCapabilityClient(googleResponse);
    const source = new GoogleCapabilitySource(
      client,
      "lingobridge-test",
      7_000,
      () => new Date("2026-09-07T12:00:00.000Z"),
    );

    const catalogue = await source.fetch(new AbortController().signal);

    expect(client.calls).toEqual([
      {
        request: {
          displayLanguageCode: "en",
          model: "projects/lingobridge-test/locations/global/models/general/nmt",
          parent: "projects/lingobridge-test/locations/global",
        },
        timeoutMilliseconds: 7_000,
      },
    ]);
    expect(catalogue).toMatchObject({
      directions: [],
      freshness: "fresh",
      googlePairing: "all-listed",
      source: "google-nmt",
      verifiedAt: "2026-09-07T12:00:00.000Z",
    });
    expect(catalogue.languages.map((language) => language.code)).toEqual(["ar", "en", "ne"]);
    expect(catalogue.languages.find((language) => language.code === "ar")).toMatchObject({
      googleSource: true,
      googleTarget: true,
      textDirection: "rtl",
    });
  });

  it("uses a content-derived version that does not change with verification time", async () => {
    const first = await new GoogleCapabilitySource(
      new RecordingCapabilityClient(googleResponse),
      "lingobridge-test",
      7_000,
      () => new Date("2026-09-07T12:00:00.000Z"),
    ).fetch(new AbortController().signal);
    const second = await new GoogleCapabilitySource(
      new RecordingCapabilityClient(googleResponse),
      "lingobridge-test",
      7_000,
      () => new Date("2026-09-08T12:00:00.000Z"),
    ).fetch(new AbortController().signal);

    expect(first.catalogueVersion).toBe(second.catalogueVersion);
    expect(first.verifiedAt).not.toBe(second.verifiedAt);
  });

  it("rejects malformed or empty provider metadata", async () => {
    const malformed = new GoogleCapabilitySource(
      new RecordingCapabilityClient({
        languages: [
          {
            displayName: "Unsafe",
            languageCode: "../secret",
            supportSource: true,
            supportTarget: true,
          },
        ],
      }),
      "lingobridge-test",
      7_000,
    );
    const empty = new GoogleCapabilitySource(
      new RecordingCapabilityClient({ languages: [] }),
      "lingobridge-test",
      7_000,
    );

    await expect(malformed.fetch(new AbortController().signal)).rejects.toMatchObject({
      name: "CapabilitySourceError",
    });
    await expect(empty.fetch(new AbortController().signal)).rejects.toMatchObject({
      name: "CapabilitySourceError",
    });
  });
});
