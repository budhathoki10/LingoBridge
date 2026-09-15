import { type ExplanationConsent, explanationConsentSchema } from "@lingobridge/contracts";
import type { ConsentStorage } from "./online-consent";

/**
 * Explain sends the selected text and its translation to a different NVIDIA model, a general
 * language model the translation consent does not describe. It is asked for once, on the first
 * Explain click, and stored separately.
 */
export const EXPLANATION_CONSENT_VERSION = "explain-nvidia-nemotron-v1";
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
