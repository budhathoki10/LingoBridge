import { describe, expect, it } from "vitest";
import {
  buildLanguageSections,
  catalogueToPreviewLanguages,
  getPreviewDirectionCapabilities,
  PREVIEW_LANGUAGES,
  searchPreviewLanguages,
} from "../../apps/extension/lib/capabilities";
import type { CapabilityCatalogue } from "../../packages/contracts/src/index";

describe("preview capability fixture", () => {
  it("finds every fixture language by name, native name, and code", () => {
    for (const language of PREVIEW_LANGUAGES) {
      expect(searchPreviewLanguages(language.name)).toContainEqual(language);
      expect(searchPreviewLanguages(language.nativeName)).toContainEqual(language);
      expect(searchPreviewLanguages(language.code)).toContainEqual(language);
    }
  });

  it("promotes favourites and recent languages without duplicating them", () => {
    const sections = buildLanguageSections("", ["ne", "en", "unknown"], ["es", "ne"]);
    const visibleCodes = sections.flatMap((section) =>
      section.languages.map((language) => language.code),
    );

    expect(sections[0]?.id).toBe("favourites");
    expect(sections[0]?.languages.map((language) => language.code)).toEqual(["ne", "en"]);
    expect(sections[1]?.id).toBe("recent");
    expect(sections[1]?.languages.map((language) => language.code)).toEqual(["es"]);
    expect(new Set(visibleCodes).size).toBe(PREVIEW_LANGUAGES.length);
    expect(visibleCodes).toHaveLength(PREVIEW_LANGUAGES.length);
  });

  it("gates enhanced capabilities separately from text translation", () => {
    expect(getPreviewDirectionCapabilities("en", "ne")).toEqual({
      standardTranslation: true,
      speech: false,
      styles: false,
      transliteration: false,
    });
    expect(getPreviewDirectionCapabilities("ar", "en")).toEqual({
      standardTranslation: true,
      speech: true,
      styles: false,
      transliteration: true,
    });
    expect(getPreviewDirectionCapabilities("en", "en").standardTranslation).toBe(false);
  });
});

describe("live capability catalogue", () => {
  const catalogue: CapabilityCatalogue = {
    catalogueVersion: "google-nmt-test",
    directions: [],
    freshness: "fresh",
    generatedAt: "2026-09-07T12:00:00.000Z",
    googlePairing: "all-listed",
    languages: [
      {
        code: "en",
        googleSource: true,
        googleTarget: true,
        name: "English",
        nativeName: null,
        textDirection: "ltr",
      },
      {
        code: "ne",
        googleSource: true,
        googleTarget: true,
        name: "Nepali",
        nativeName: "नेपाली",
        textDirection: "ltr",
      },
    ],
    source: "google-nmt",
    verifiedAt: "2026-09-07T12:00:00.000Z",
  };

  it("builds picker languages from the provider catalogue", () => {
    const languages = catalogueToPreviewLanguages(catalogue);

    expect(languages).toEqual([
      {
        code: "en",
        name: "English",
        nativeName: "English",
        supportsSpeech: false,
        textDirection: "ltr",
      },
      {
        code: "ne",
        name: "Nepali",
        nativeName: "नेपाली",
        supportsSpeech: false,
        textDirection: "ltr",
      },
    ]);
    expect(buildLanguageSections("Nepali", [], [], languages)[0]?.languages).toHaveLength(1);
  });

  it("derives exact Google support from compact source and target flags", () => {
    const languages = catalogueToPreviewLanguages(catalogue);

    expect(
      getPreviewDirectionCapabilities("en", "ne", catalogue, languages).standardTranslation,
    ).toBe(true);
    expect(
      getPreviewDirectionCapabilities("ne", "ne", catalogue, languages).standardTranslation,
    ).toBe(false);
    expect(
      getPreviewDirectionCapabilities("fr", "ne", catalogue, languages).standardTranslation,
    ).toBe(false);
  });
});
