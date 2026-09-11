import {
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
  type LanguageCapability,
} from "@lingobridge/contracts";
import { createHash } from "node:crypto";
import type { CapabilityCatalogueSource } from "./capability-catalogue-service.js";

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

export const NVIDIA_LANGUAGE_CODES = new Set(nvidiaLanguages.map((language) => language.code));

export function supportsNvidiaTranslationPair(sourceLanguage: string, targetLanguage: string) {
  if (sourceLanguage === "auto") return false;
  if (sourceLanguage === targetLanguage) return false;
  return (
    (sourceLanguage === "en" && NVIDIA_LANGUAGE_CODES.has(targetLanguage)) ||
    (targetLanguage === "en" && NVIDIA_LANGUAGE_CODES.has(sourceLanguage))
  );
}

function nvidiaDirections() {
  return nvidiaLanguages
    .filter((language) => language.code !== "en")
    .flatMap((language) => [
      {
        google: false,
        nvidia: true,
        nvidiaBackup: false,
        sourceLanguage: "en",
        targetLanguage: language.code,
      },
      {
        google: false,
        nvidia: true,
        nvidiaBackup: false,
        sourceLanguage: language.code,
        targetLanguage: "en",
      },
    ]);
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
    catalogueVersion: catalogueVersion(nvidiaLanguages),
    directions: nvidiaDirections(),
    freshness: "fresh",
    generatedAt: timestamp,
    googlePairing: "explicit",
    languages: nvidiaLanguages,
    source: "nvidia-riva",
    verifiedAt: timestamp,
  });
}

export function mergeNvidiaWithGoogleCatalogue(
  googleCatalogue: CapabilityCatalogue,
  now = new Date(),
): CapabilityCatalogue {
  const byCode = new Map<string, LanguageCapability>();
  for (const language of googleCatalogue.languages) byCode.set(language.code, language);
  for (const language of nvidiaLanguages) {
    const googleLanguage = byCode.get(language.code);
    byCode.set(language.code, googleLanguage ? { ...language, ...googleLanguage } : language);
  }

  const nvidiaCodes = new Set(nvidiaLanguages.map((language) => language.code));
  const googleDirections = googleCatalogue.directions.map((direction) => ({
    ...direction,
    nvidia: supportsNvidiaTranslationPair(direction.sourceLanguage, direction.targetLanguage),
    nvidiaBackup: false,
  }));
  const googleDirectionKeys = new Set(
    googleDirections.map((direction) => `${direction.sourceLanguage}:${direction.targetLanguage}`),
  );
  const explicitNvidiaDirections = nvidiaDirections().filter(
    (direction) =>
      !googleDirectionKeys.has(`${direction.sourceLanguage}:${direction.targetLanguage}`),
  );
  const languages = [...byCode.values()].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
  const timestamp = now.toISOString();

  return capabilityCatalogueSchema.parse({
    catalogueVersion: `hybrid-${createHash("sha256")
      .update(
        JSON.stringify({
          google: googleCatalogue.catalogueVersion,
          nvidia: [...nvidiaCodes].sort(),
        }),
      )
      .digest("hex")
      .slice(0, 24)}`,
    directions: [...googleDirections, ...explicitNvidiaDirections],
    freshness: "fresh",
    generatedAt: timestamp,
    googlePairing: googleCatalogue.googlePairing,
    languages,
    source: "hybrid-online",
    verifiedAt: timestamp,
  });
}

export class OnlineProviderCapabilitySource implements CapabilityCatalogueSource {
  constructor(private readonly googleSource: CapabilityCatalogueSource | null) {}

  async fetch(signal: AbortSignal): Promise<CapabilityCatalogue> {
    if (!this.googleSource) return createNvidiaCapabilityCatalogue();

    const googleCatalogue = await this.googleSource.fetch(signal);
    return mergeNvidiaWithGoogleCatalogue(googleCatalogue);
  }
}
