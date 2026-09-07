import {
  PREVIEW_LANGUAGES,
  buildLanguageSections,
  getPreviewDirectionCapabilities,
  searchPreviewLanguages,
} from "../../apps/extension/lib/capabilities";
import { describe, expect, it } from "vitest";

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
