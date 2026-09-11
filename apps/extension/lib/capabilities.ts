export type TextDirection = "ltr" | "rtl";

export interface PreviewLanguage {
  code: string;
  name: string;
  nativeName: string;
  textDirection: TextDirection;
  supportsSpeech: boolean;
}

export interface PreviewDirectionCapabilities {
  standardTranslation: boolean;
  speech: boolean;
  styles: false;
  transliteration: boolean;
}

export interface LanguageSection {
  id: "all" | "favourites" | "recent" | "results";
  label: string;
  languages: PreviewLanguage[];
}

export const AUTO_LANGUAGE_CODE = "auto";

export const PREVIEW_LANGUAGES: readonly PreviewLanguage[] = [
  {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    textDirection: "rtl",
    supportsSpeech: true,
  },
  {
    code: "zh-CN",
    name: "Chinese (Simplified)",
    nativeName: "简体中文",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "en",
    name: "English",
    nativeName: "English",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "fr",
    name: "French",
    nativeName: "Français",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "de",
    name: "German",
    nativeName: "Deutsch",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "he",
    name: "Hebrew",
    nativeName: "עברית",
    textDirection: "rtl",
    supportsSpeech: false,
  },
  {
    code: "hi",
    name: "Hindi",
    nativeName: "हिन्दी",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "ne",
    name: "Nepali",
    nativeName: "नेपाली",
    textDirection: "ltr",
    supportsSpeech: false,
  },
  {
    code: "ru",
    name: "Russian",
    nativeName: "Русский",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "es",
    name: "Spanish",
    nativeName: "Español",
    textDirection: "ltr",
    supportsSpeech: true,
  },
  {
    code: "th",
    name: "Thai",
    nativeName: "ไทย",
    textDirection: "ltr",
    supportsSpeech: true,
  },
] as const;

export function catalogueToPreviewLanguages(catalogue: CapabilityCatalogue): PreviewLanguage[] {
  return catalogue.languages.map((language) => ({
    code: language.code,
    name: language.name,
    nativeName: language.nativeName ?? language.name,
    supportsSpeech: false,
    textDirection: language.textDirection,
  }));
}

export function getPreviewLanguage(
  code: string,
  languages: readonly PreviewLanguage[] = PREVIEW_LANGUAGES,
): PreviewLanguage | undefined {
  return languages.find((language) => language.code === code);
}

function normalizeSearchValue(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().trim();
}

export function searchPreviewLanguages(
  query: string,
  languages: readonly PreviewLanguage[] = PREVIEW_LANGUAGES,
): PreviewLanguage[] {
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return [...languages];
  }

  return languages.filter((language) =>
    [language.name, language.nativeName, language.code].some((value) =>
      normalizeSearchValue(value).includes(normalizedQuery),
    ),
  );
}

function uniqueKnownCodes(codes: readonly string[], knownCodes: ReadonlySet<string>): string[] {
  return [...new Set(codes)].filter((code) => knownCodes.has(code));
}

export function buildLanguageSections(
  query: string,
  favouriteCodes: readonly string[],
  recentCodes: readonly string[],
  languages: readonly PreviewLanguage[] = PREVIEW_LANGUAGES,
): LanguageSection[] {
  const knownCodes = new Set(languages.map((language) => language.code));
  if (query.trim()) {
    return [
      {
        id: "results",
        label: "Search results",
        languages: searchPreviewLanguages(query, languages),
      },
    ];
  }

  const favourites = uniqueKnownCodes(favouriteCodes, knownCodes);
  const favouriteSet = new Set(favourites);
  const recent = uniqueKnownCodes(recentCodes, knownCodes).filter(
    (code) => !favouriteSet.has(code),
  );
  const promotedCodes = new Set([...favourites, ...recent]);
  const byCode = new Map(languages.map((language) => [language.code, language]));
  const sections: LanguageSection[] = [];

  if (favourites.length > 0) {
    sections.push({
      id: "favourites",
      label: "Favourites",
      languages: favourites.flatMap((code) => {
        const language = byCode.get(code);
        return language ? [language] : [];
      }),
    });
  }

  if (recent.length > 0) {
    sections.push({
      id: "recent",
      label: "Recent",
      languages: recent.flatMap((code) => {
        const language = byCode.get(code);
        return language ? [language] : [];
      }),
    });
  }

  sections.push({
    id: "all",
    label: "All languages",
    languages: languages.filter((language) => !promotedCodes.has(language.code)),
  });

  return sections;
}

const transliterationPairs = new Set(["ar:en", "hi:en", "ne:en"]);

export function getPreviewDirectionCapabilities(
  sourceLanguage: string,
  targetLanguage: string,
  catalogue?: CapabilityCatalogue | null,
  languages: readonly PreviewLanguage[] = PREVIEW_LANGUAGES,
): PreviewDirectionCapabilities {
  const source = getPreviewLanguage(sourceLanguage, languages);
  const target = getPreviewLanguage(targetLanguage, languages);
  const differentLanguages =
    sourceLanguage === AUTO_LANGUAGE_CODE || sourceLanguage !== targetLanguage;
  let standardTranslation = Boolean(target && differentLanguages);

  if (catalogue) {
    const targetCapability = catalogue.languages.find(
      (language) => language.code === targetLanguage,
    );
    if (sourceLanguage === AUTO_LANGUAGE_CODE) {
      standardTranslation = Boolean(
        targetCapability?.googleTarget &&
          catalogue.languages.some((language) => language.googleSource),
      );
    } else if (catalogue.googlePairing === "all-listed") {
      const explicitProviderDirection = catalogue.directions.some(
        (direction) =>
          direction.sourceLanguage === sourceLanguage &&
          direction.targetLanguage === targetLanguage &&
          (direction.google || direction.nvidia),
      );
      standardTranslation = Boolean(
        explicitProviderDirection ||
          (differentLanguages &&
            targetCapability?.googleTarget &&
            catalogue.languages.find(
              (language) => language.code === sourceLanguage && language.googleSource,
            )),
      );
    } else {
      standardTranslation = catalogue.directions.some(
        (direction) =>
          (direction.google || direction.nvidia) &&
          direction.sourceLanguage === sourceLanguage &&
          direction.targetLanguage === targetLanguage,
      );
    }
  }

  return {
    standardTranslation,
    speech: Boolean(target?.supportsSpeech),
    styles: false,
    transliteration: Boolean(
      source && target && transliterationPairs.has(`${source.code}:${target.code}`),
    ),
  };
}

export function inferPreviewLanguage(text: string): string {
  if (/[֐-׿]/u.test(text)) return "he";
  if (/[؀-ۿ]/u.test(text)) return "ar";
  if (/[ऀ-ॿ]/u.test(text)) return "ne";
  if (/[฀-๿]/u.test(text)) return "th";
  if (/[぀-ヿ]/u.test(text)) return "ja";
  if (/[㐀-鿿]/u.test(text)) return "zh-CN";
  if (/[Ѐ-ӿ]/u.test(text)) return "ru";
  return "en";
}

import type { CapabilityCatalogue } from "@lingobridge/contracts";
