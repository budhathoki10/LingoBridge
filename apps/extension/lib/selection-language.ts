import type { CapabilityCatalogue } from "@lingobridge/contracts";
import { detectTextLanguage } from "./language-detection";
import {
  looksLikeRomanizedNepali,
  normalizeRomanizedNepali,
  type RomanizedNepaliNormalization,
} from "./romanized-nepali";

export interface ResolvedSelectionSource {
  /** True when detection came up empty and English is standing in for a real answer. */
  assumed: boolean;
  code: string;
  romanizedNepali: RomanizedNepaliNormalization | null;
}

export function isSupportedSelectionTarget(
  catalogue: CapabilityCatalogue,
  targetLanguage: string,
): boolean {
  const language = catalogue.languages.find((candidate) => candidate.code === targetLanguage);
  return Boolean(
    language &&
      (language.googleTarget ||
        language.myMemoryTarget ||
        catalogue.directions.some(
          (direction) =>
            direction.targetLanguage === targetLanguage && (direction.myMemory || direction.nvidia),
        )),
  );
}

/**
 * Targets reachable from one source through the active primary or fallback provider.
 */
export function supportedTargetsForSource(
  catalogue: CapabilityCatalogue,
  sourceLanguage: string,
): string[] {
  if (catalogue.googlePairing === "all-listed") {
    const source = catalogue.languages.find((language) => language.code === sourceLanguage);
    if (source?.myMemorySource || source?.googleSource) {
      return catalogue.languages
        .filter(
          (language) =>
            language.code !== sourceLanguage && (language.myMemoryTarget || language.googleTarget),
        )
        .map((language) => language.code);
    }
  }
  return [
    ...new Set(
      catalogue.directions
        .filter(
          (direction) =>
            direction.sourceLanguage === sourceLanguage &&
            (direction.myMemory || direction.nvidia || direction.google),
        )
        .map((direction) => direction.targetLanguage),
    ),
  ];
}

/**
 * Works out what language the selection is in. The panel has no source picker, because the only
 * configured provider treats the language pair as an instruction and cannot detect anything.
 */
export function resolveSelectionSource(
  text: string,
  catalogue: CapabilityCatalogue,
): ResolvedSelectionSource {
  const detected = detectTextLanguage(text);
  const romanizedNepali =
    normalizeRomanizedNepali(text) ??
    (detected.length === 0 || detected[0] === "ne" ? looksLikeRomanizedNepali(text) : null);
  if (
    romanizedNepali &&
    catalogue.languages.some(
      (language) => language.code === "ne" && (language.myMemorySource || language.googleSource),
    )
  ) {
    return { assumed: false, code: "ne", romanizedNepali };
  }
  for (const candidate of detected) {
    if (catalogue.languages.some((language) => language.code === candidate)) {
      return { assumed: false, code: candidate, romanizedNepali: null };
    }
  }
  return { assumed: true, code: "en", romanizedNepali: null };
}

export function chooseSelectionTargetLanguage(
  catalogue: CapabilityCatalogue,
  preferredLanguage: string,
  sourceLanguage: string,
): string {
  const targets = supportedTargetsForSource(catalogue, sourceLanguage);
  if (targets.includes(preferredLanguage)) return preferredLanguage;
  for (const fallback of ["ne", "en"]) {
    if (targets.includes(fallback)) return fallback;
  }
  return targets[0] ?? preferredLanguage;
}
