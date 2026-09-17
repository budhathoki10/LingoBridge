import { type ExplanationConsent, explanationConsentSchema } from "@lingobridge/contracts";
import type { ConsentStorage } from "./online-consent";

/**
 * Explain and word understanding send the selected text and its translation to NVIDIA Nemotron,
 * and to an OpenRouter model when NVIDIA cannot answer. Translation consent covers neither, so this
 * is asked for once, on the first click, and stored separately. The version changes whenever the
 * named providers change, so readers who accepted an older list are asked again.
 */
export const EXPLANATION_CONSENT_VERSION = "explain-nvidia-openrouter-v2";
const STORAGE_KEY = "lingobridgeExplanationConsent";

function extensionStorage(): ConsentStorage {
  const runtime = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: ConsentStorage } };
  };
  const storage = runtime.chrome?.storage?.local;
  if (!storage) throw new Error("Extension storage is unavailable.");
  return storage;
}

export function createExplanationConsentRepository(storage: ConsentStorage) {
  return {
    async accept(): Promise<ExplanationConsent> {
      const consent = explanationConsentSchema.parse({
        acceptedAt: new Date().toISOString(),
        nvidia: true,
        openRouter: true,
        version: EXPLANATION_CONSENT_VERSION,
      });
      await storage.set({ [STORAGE_KEY]: consent });
      return consent;
    },
    async load(): Promise<ExplanationConsent | null> {
      const stored = await storage.get(STORAGE_KEY);
      const parsed = explanationConsentSchema.safeParse(stored[STORAGE_KEY]);
      if (!parsed.success || parsed.data.version !== EXPLANATION_CONSENT_VERSION) return null;
      return parsed.data;
    },
    async revoke(): Promise<void> {
      await storage.remove(STORAGE_KEY);
    },
  };
}

export function acceptExplanationConsent(): Promise<ExplanationConsent> {
  return createExplanationConsentRepository(extensionStorage()).accept();
}

export function loadExplanationConsent(): Promise<ExplanationConsent | null> {
  return createExplanationConsentRepository(extensionStorage()).load();
}
