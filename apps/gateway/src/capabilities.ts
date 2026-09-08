import {
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
  type LanguageCapability,
} from "@lingobridge/contracts";

const languageMetadata: Array<Omit<LanguageCapability, "googleSource" | "googleTarget">> = [
  { code: "ar", name: "Arabic", nativeName: "العربية", textDirection: "rtl" },
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文", textDirection: "ltr" },
  { code: "en", name: "English", nativeName: "English", textDirection: "ltr" },
  { code: "fr", name: "French", nativeName: "Français", textDirection: "ltr" },
  { code: "de", name: "German", nativeName: "Deutsch", textDirection: "ltr" },
  { code: "he", name: "Hebrew", nativeName: "עברית", textDirection: "rtl" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", textDirection: "ltr" },
  { code: "ja", name: "Japanese", nativeName: "日本語", textDirection: "ltr" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", textDirection: "ltr" },
  { code: "ru", name: "Russian", nativeName: "Русский", textDirection: "ltr" },
  { code: "es", name: "Spanish", nativeName: "Español", textDirection: "ltr" },
  { code: "th", name: "Thai", nativeName: "ไทย", textDirection: "ltr" },
];

const languages: LanguageCapability[] = languageMetadata.map((language) => ({
  ...language,
  googleSource: true,
  googleTarget: true,
}));

export const fakeCapabilityCatalogue: CapabilityCatalogue = capabilityCatalogueSchema.parse({
  catalogueVersion: "phase-3.1-fake-2026-09-07",
  directions: languages.flatMap((source) =>
    languages
      .filter((target) => target.code !== source.code)
      .map((target) => ({
        google: true,
        nvidia: false,
        nvidiaBackup: false,
        sourceLanguage: source.code,
        targetLanguage: target.code,
      })),
  ),
  freshness: "fresh",
  generatedAt: "2026-09-07T00:00:00.000Z",
  googlePairing: "explicit",
  languages,
  source: "fake",
  verifiedAt: "2026-09-07T00:00:00.000Z",
});

export function supportsTranslation(
  catalogue: CapabilityCatalogue,
  sourceLanguage: string,
  targetLanguage: string,
): boolean {
  if (catalogue.googlePairing === "all-listed") {
    const target = catalogue.languages.find((language) => language.code === targetLanguage);
    const explicitDirection = catalogue.directions.some(
      (direction) =>
        direction.sourceLanguage === sourceLanguage &&
        direction.targetLanguage === targetLanguage &&
        (direction.google || direction.nvidia),
    );
    if (explicitDirection) return true;
    if (!target?.googleTarget) return false;
    if (sourceLanguage === "auto") {
      return catalogue.languages.some((language) => language.googleSource);
    }
    return Boolean(
      catalogue.languages.find(
        (language) => language.code === sourceLanguage && language.googleSource,
      ),
    );
  }

  if (sourceLanguage === "auto") {
    return catalogue.directions.some(
      (direction) => direction.targetLanguage === targetLanguage && direction.google,
    );
  }

  return catalogue.directions.some(
    (direction) =>
      direction.sourceLanguage === sourceLanguage &&
      direction.targetLanguage === targetLanguage &&
      (direction.google || direction.nvidia),
  );
}
