import { describe, expect, it } from "vitest";
import {
  addRecentLanguage,
  normalizePopupPreferences,
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
});
