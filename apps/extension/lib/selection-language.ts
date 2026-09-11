import type { CapabilityCatalogue } from "@lingobridge/contracts";
import { detectTextLanguage } from "./language-detection";

export interface ResolvedSelectionSource {
  /** True when detection came up empty and English is standing in for a real answer. */
  assumed: boolean;
  code: string;
}

export function isSupportedSelectionTarget(
  catalogue: CapabilityCatalogue,
  targetLanguage: string,
): boolean {
  const language = catalogue.languages.find((candidate) => candidate.code === targetLanguage);
  return Boolean(
    language &&
      (language.googleTarget ||
        catalogue.directions.some(
          (direction) => direction.targetLanguage === targetLanguage && direction.nvidia,
        )),
  );
}

/**
 * Targets reachable from one source. NVIDIA pairs English with everything and nothing with
 * anything else, so a French selection legitimately has exactly one destination.
 */
export function supportedTargetsForSource(
  catalogue: CapabilityCatalogue,
  sourceLanguage: string,
): string[] {
  return [
    ...new Set(
      catalogue.directions
        .filter(
          (direction) =>
            direction.sourceLanguage === sourceLanguage && (direction.nvidia || direction.google),
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
  for (const candidate of detectTextLanguage(text)) {
    if (catalogue.languages.some((language) => language.code === candidate)) {
      return { assumed: false, code: candidate };
    }
  }
  return { assumed: true, code: "en" };
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
