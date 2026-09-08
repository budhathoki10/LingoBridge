import { describe, expect, it } from "vitest";
import {
  addRecentLanguage,
  normalizePopupPreferences,
} from "../../apps/extension/lib/popup-preferences";

describe("popup preferences", () => {
  it("keeps only bounded, known language codes", () => {
    expect(
      normalizePopupPreferences({
        favouriteLanguageCodes: ["ne", "ne", "not-real", 42],
        recentLanguageCodes: ["es", "fr", "de", "ar", "he", "ja"],
        targetLanguage: "not-real",
      }),
    ).toEqual({
      favouriteLanguageCodes: ["ne"],
      recentLanguageCodes: ["es", "fr", "de", "ar", "he"],
      targetLanguage: "ne",
    });
  });

  it("moves a selected language to the front of the recent list", () => {
    expect(addRecentLanguage(["en", "es", "fr"], "es")).toEqual(["es", "en", "fr"]);
  });
});
