import { describe, expect, it } from "vitest";
import {
  addRecentLanguage,
  normalizePopupPreferences,
  replaceAvailableFavourites,
  toggleFavouriteLanguage,
} from "../../apps/extension/lib/popup-preferences";

describe("popup preferences", () => {
  it("keeps bounded valid language codes from the live catalogue", () => {
    expect(
      normalizePopupPreferences({
        favouriteLanguageCodes: ["ne", "ne", "not_real", 42],
        recentLanguageCodes: ["es", "fr", "de", "ar", "he", "ja"],
        targetLanguage: "not_real",
      }),
    ).toEqual({
      favouriteLanguageCodes: ["ne"],
      recentLanguageCodes: ["es", "fr", "de", "ar", "he"],
      targetLanguage: "ne",
    });
  });

  it("preserves a valid provider language that is not in the preview fixture", () => {
    expect(
      normalizePopupPreferences({
        favouriteLanguageCodes: ["pt-BR"],
        recentLanguageCodes: ["uk"],
        targetLanguage: "pt-BR",
      }),
    ).toMatchObject({
      favouriteLanguageCodes: ["pt-BR"],
      recentLanguageCodes: ["uk"],
      targetLanguage: "pt-BR",
    });
  });

  it("moves a selected language to the front of the recent list", () => {
    expect(addRecentLanguage(["en", "es", "fr"], "es")).toEqual(["es", "en", "fr"]);
  });

  it("pins several languages without duplicates and lets each be removed", () => {
    expect(toggleFavouriteLanguage(["ne", "en"], "fr")).toEqual(["fr", "ne", "en"]);
    expect(toggleFavouriteLanguage(["fr", "ne", "en"], "ne")).toEqual(["fr", "en"]);
    expect(toggleFavouriteLanguage(["ne"], "not_real")).toEqual(["ne"]);
  });

  it("saves several selected favorites together while retaining pins unavailable for this source", () => {
    expect(replaceAvailableFavourites(["ne", "fr"], ["fr", "hi", "es"], ["hi", "es"])).toEqual([
      "ne",
      "hi",
      "es",
    ]);
  });
});
