import {
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
  type LanguageCapability,
} from "@lingobridge/contracts";
import { createHash } from "node:crypto";
import type { CapabilityCatalogueSource } from "./capability-catalogue-service.js";
import { MYMEMORY_LANGUAGE_ENTRIES } from "./mymemory-languages.js";

export const NVIDIA_RIVA_MODEL = "nvidia/riva-translate-4b-instruct-v2";

const nvidiaLanguages: LanguageCapability[] = [
  {
    code: "ar",
    googleSource: false,
    googleTarget: false,
    name: "Arabic",
    nativeName: null,
    textDirection: "rtl",
  },
  {
    code: "bg",
    googleSource: false,
    googleTarget: false,
    name: "Bulgarian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "cs",
    googleSource: false,
    googleTarget: false,
    name: "Czech",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "da",
    googleSource: false,
    googleTarget: false,
    name: "Danish",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "de",
    googleSource: false,
    googleTarget: false,
    name: "German",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "el",
    googleSource: false,
    googleTarget: false,
    name: "Greek",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "en",
    googleSource: false,
    googleTarget: false,
    name: "English",
    nativeName: "English",
    textDirection: "ltr",
  },
  {
    code: "es-ES",
    googleSource: false,
    googleTarget: false,
    name: "European Spanish",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "es-US",
    googleSource: false,
    googleTarget: false,
    name: "LATAM Spanish",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "et",
    googleSource: false,
    googleTarget: false,
    name: "Estonian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "fi",
    googleSource: false,
    googleTarget: false,
    name: "Finnish",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "fr",
    googleSource: false,
    googleTarget: false,
    name: "French",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "hi",
    googleSource: false,
    googleTarget: false,
    name: "Hindi",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "hr",
    googleSource: false,
    googleTarget: false,
    name: "Croatian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "hu",
    googleSource: false,
    googleTarget: false,
    name: "Hungarian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "id",
    googleSource: false,
    googleTarget: false,
    name: "Indonesian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "it",
    googleSource: false,
    googleTarget: false,
    name: "Italian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "ja",
    googleSource: false,
    googleTarget: false,
    name: "Japanese",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "ko",
    googleSource: false,
    googleTarget: false,
    name: "Korean",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "lt",
    googleSource: false,
    googleTarget: false,
    name: "Lithuanian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "lv",
    googleSource: false,
    googleTarget: false,
    name: "Latvian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "nl",
    googleSource: false,
    googleTarget: false,
    name: "Dutch",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "no",
    googleSource: false,
    googleTarget: false,
    name: "Norwegian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "pl",
    googleSource: false,
    googleTarget: false,
    name: "Polish",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "pt-BR",
    googleSource: false,
    googleTarget: false,
    name: "Brazilian Portuguese",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "pt-PT",
    googleSource: false,
    googleTarget: false,
    name: "European Portuguese",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "ro",
    googleSource: false,
    googleTarget: false,
    name: "Romanian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "ru",
    googleSource: false,
    googleTarget: false,
    name: "Russian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "sk",
    googleSource: false,
    googleTarget: false,
    name: "Slovak",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "sl",
    googleSource: false,
    googleTarget: false,
    name: "Slovenian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "sv",
    googleSource: false,
    googleTarget: false,
    name: "Swedish",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "th",
    googleSource: false,
    googleTarget: false,
    name: "Thai",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "tr",
    googleSource: false,
    googleTarget: false,
    name: "Turkish",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "uk",
    googleSource: false,
    googleTarget: false,
    name: "Ukrainian",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "vi",
    googleSource: false,
    googleTarget: false,
    name: "Vietnamese",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "zh-CN",
    googleSource: false,
    googleTarget: false,
    name: "Simplified Chinese",
    nativeName: null,
    textDirection: "ltr",
  },
  {
    code: "zh-TW",
    googleSource: false,
    googleTarget: false,
    name: "Traditional Chinese",
    nativeName: null,
    textDirection: "ltr",
  },
];

function textDirection(languageCode: string): "ltr" | "rtl" {
  try {
    const locale = new Intl.Locale(languageCode) as Intl.Locale & {
      textInfo?: { direction?: string };
    };
    return locale.textInfo?.direction === "rtl" ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}

function nativeLanguageName(languageCode: string, englishName: string): string | null {
  try {
    const name = new Intl.DisplayNames([languageCode], { type: "language" }).of(languageCode);
    if (!name || name === languageCode || name === englishName || name.length > 100) return null;
    return name;
  } catch {
    return null;
  }
}

const myMemoryLanguages: LanguageCapability[] = MYMEMORY_LANGUAGE_ENTRIES.map(({ code, name }) => ({
  code,
  googleSource: false,
  googleTarget: false,
  myMemorySource: true,
  myMemoryTarget: true,
  name,
  nativeName: nativeLanguageName(code, name),
  textDirection: textDirection(code),
}));

const legacyMyMemoryAliases: LanguageCapability[] = [
  {
    code: "ne",
    googleSource: false,
    googleTarget: false,
    myMemorySource: true,
    myMemoryTarget: true,
    name: "Nepali",
    nativeName: "नेपाली",
    textDirection: "ltr",
  },
];

// Keep the existing model tags as provider-compatible aliases for saved preferences and detection.
const onlineLanguages = [
  ...new Map(
    [
      ...myMemoryLanguages,
      ...legacyMyMemoryAliases,
      ...nvidiaLanguages.map((language) => ({
        ...language,
        myMemorySource: true,
        myMemoryTarget: true,
      })),
    ].map((language) => [language.code, language]),
  ).values(),
].sort(
  (left, right) => left.name.localeCompare(right.name, "en") || left.code.localeCompare(right.code),
);

const MYMEMORY_TO_NVIDIA_LANGUAGE = new Map<string, string>([
  ["ar-SA", "ar"],
  ["bg-BG", "bg"],
  ["cs-CZ", "cs"],
  ["da-DK", "da"],
  ["de-DE", "de"],
  ["el-GR", "el"],
  ["en-GB", "en"],
  ["et-EE", "et"],
  ["fi-FI", "fi"],
  ["fr-FR", "fr"],
  ["hi-IN", "hi"],
  ["hr-HR", "hr"],
  ["hu-HU", "hu"],
  ["id-ID", "id"],
  ["it-IT", "it"],
  ["ja-JP", "ja"],
  ["ko-KR", "ko"],
  ["lt-LT", "lt"],
  ["lv-LV", "lv"],
  ["nb-NO", "no"],
  ["nl-NL", "nl"],
  ["pl-PL", "pl"],
  ["ro-RO", "ro"],
  ["ru-RU", "ru"],
  ["sk-SK", "sk"],
  ["sl-SI", "sl"],
  ["sv-SE", "sv"],
  ["th-TH", "th"],
  ["tr-TR", "tr"],
  ["uk-UA", "uk"],
  ["vi-VN", "vi"],
]);

export const NVIDIA_LANGUAGE_CODES = new Set(nvidiaLanguages.map((language) => language.code));

export function toNvidiaLanguageCode(languageCode: string): string | null {
  if (NVIDIA_LANGUAGE_CODES.has(languageCode)) return languageCode;
  const mapped = MYMEMORY_TO_NVIDIA_LANGUAGE.get(languageCode);
  return mapped && NVIDIA_LANGUAGE_CODES.has(mapped) ? mapped : null;
}

export function supportsNvidiaTranslationPair(sourceLanguage: string, targetLanguage: string) {
  if (sourceLanguage === "auto") return false;
  const source = toNvidiaLanguageCode(sourceLanguage);
  const target = toNvidiaLanguageCode(targetLanguage);
  if (!source || !target || source === target) return false;
  return (
    (source === "en" && NVIDIA_LANGUAGE_CODES.has(target)) ||
    (target === "en" && NVIDIA_LANGUAGE_CODES.has(source))
  );
}

function nvidiaDirections(languages: readonly LanguageCapability[]) {
  return languages.flatMap((source) =>
    languages
      .filter((target) => supportsNvidiaTranslationPair(source.code, target.code))
      .map((target) => ({
        google: false,
        myMemory: true,
        nvidia: true,
        nvidiaBackup: true,
        sourceLanguage: source.code,
        targetLanguage: target.code,
      })),
  );
}

function catalogueVersion(languages: readonly LanguageCapability[]) {
  const content = JSON.stringify({
    languages: languages.map(({ code }) => code).sort(),
    model: NVIDIA_RIVA_MODEL,
    pairing: "english-pivot",
  });
  return `nvidia-riva-${createHash("sha256").update(content).digest("hex").slice(0, 24)}`;
}

export function createNvidiaCapabilityCatalogue(now = new Date()): CapabilityCatalogue {
  const timestamp = now.toISOString();
  return capabilityCatalogueSchema.parse({
    catalogueVersion: `mymemory-${catalogueVersion(onlineLanguages)}`,
    directions: nvidiaDirections(onlineLanguages),
    freshness: "fresh",
    generatedAt: timestamp,
    googlePairing: "all-listed",
    languages: onlineLanguages,
    source: "hybrid-online",
    verifiedAt: timestamp,
  });
}

export function mergeNvidiaWithGoogleCatalogue(
  googleCatalogue: CapabilityCatalogue,
  now = new Date(),
): CapabilityCatalogue {
  const byCode = new Map<string, LanguageCapability>();
  for (const language of onlineLanguages) byCode.set(language.code, language);
  for (const googleLanguage of googleCatalogue.languages) {
    const myMemoryLanguage = byCode.get(googleLanguage.code);
    if (myMemoryLanguage) {
      byCode.set(googleLanguage.code, {
        ...myMemoryLanguage,
        googleSource: googleLanguage.googleSource,
        googleTarget: googleLanguage.googleTarget,
      });
    }
  }

  const languages = [...byCode.values()].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
  const timestamp = now.toISOString();

  return capabilityCatalogueSchema.parse({
    catalogueVersion: `hybrid-${createHash("sha256")
      .update(
        JSON.stringify({
          google: googleCatalogue.catalogueVersion,
          myMemory: MYMEMORY_LANGUAGE_ENTRIES.map(({ code }) => code),
          nvidia: [...NVIDIA_LANGUAGE_CODES].sort(),
        }),
      )
      .digest("hex")
      .slice(0, 24)}`,
    directions: nvidiaDirections(languages),
    freshness: "fresh",
    generatedAt: timestamp,
    googlePairing: "all-listed",
    languages,
    source: "hybrid-online",
    verifiedAt: timestamp,
  });
}

export function isCurrentOnlineCapabilityCatalogue(catalogue: CapabilityCatalogue): boolean {
  return (
    catalogue.source === "hybrid-online" &&
    catalogue.googlePairing === "all-listed" &&
    catalogue.languages.some((language) => language.myMemorySource && language.myMemoryTarget)
  );
}

export class OnlineProviderCapabilitySource implements CapabilityCatalogueSource {
  constructor(private readonly googleSource: CapabilityCatalogueSource | null) {}

  async fetch(signal: AbortSignal): Promise<CapabilityCatalogue> {
    if (!this.googleSource) return createNvidiaCapabilityCatalogue();

    const googleCatalogue = await this.googleSource.fetch(signal);
    return mergeNvidiaWithGoogleCatalogue(googleCatalogue);
  }
}
