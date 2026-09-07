import { PREVIEW_LANGUAGES } from "./capabilities";

export interface PopupPreferences {
  favouriteLanguageCodes: string[];
  recentLanguageCodes: string[];
  targetLanguage: string;
}

export const DEFAULT_POPUP_PREFERENCES: PopupPreferences = {
  favouriteLanguageCodes: ["ne", "en"],
  recentLanguageCodes: [],
  targetLanguage: "ne",
};

const STORAGE_KEY = "phase2PopupPreferences";
const validCodes = new Set(PREVIEW_LANGUAGES.map((language) => language.code));

interface ExtensionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function cleanCodes(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(value)]
    .filter((code): code is string => typeof code === "string" && validCodes.has(code))
    .slice(0, maximum);
}

export function normalizePopupPreferences(value: unknown): PopupPreferences {
  if (!value || typeof value !== "object") return DEFAULT_POPUP_PREFERENCES;

  const candidate = value as Partial<PopupPreferences>;

  return {
    favouriteLanguageCodes: cleanCodes(candidate.favouriteLanguageCodes, 12),
    recentLanguageCodes: cleanCodes(candidate.recentLanguageCodes, 5),
    targetLanguage:
      typeof candidate.targetLanguage === "string" && validCodes.has(candidate.targetLanguage)
        ? candidate.targetLanguage
        : DEFAULT_POPUP_PREFERENCES.targetLanguage,
  };
}

function getExtensionStorage(): ExtensionStorageArea | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: ExtensionStorageArea } };
  };
  return extensionGlobal.chrome?.storage?.local;
}

export async function loadPopupPreferences(): Promise<PopupPreferences> {
  const storage = getExtensionStorage();
  if (!storage) return DEFAULT_POPUP_PREFERENCES;

  const stored = await storage.get(STORAGE_KEY);
  return normalizePopupPreferences(stored[STORAGE_KEY]);
}

export async function savePopupPreferences(preferences: PopupPreferences): Promise<void> {
  const storage = getExtensionStorage();
  if (!storage) return;
  await storage.set({ [STORAGE_KEY]: normalizePopupPreferences(preferences) });
}

export function addRecentLanguage(codes: readonly string[], languageCode: string): string[] {
  return cleanCodes([languageCode, ...codes.filter((code) => code !== languageCode)], 5);
}
