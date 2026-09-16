import type { TranslationRequest, TranslationResult } from "@lingobridge/contracts";
import { supportsNvidiaTranslationPair } from "./nvidia-capabilities.js";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

export interface ProviderRouterOptions {
  myMemory: TranslationAdapter;
  nvidia: TranslationAdapter;
  /** Told whenever NVIDIA serves as the backup, with whether the backup succeeded. */
  onFallback?: (succeeded: boolean) => void;
}

export class MyMemoryPrimaryProviderRouter implements TranslationAdapter {
  constructor(private readonly options: ProviderRouterOptions) {}

  async translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    if (request.consent.myMemory) {
      try {
        return await this.options.myMemory.translate(request, signal);
      } catch (error) {
        if (
          !request.consent.nvidiaBackup ||
          !request.consent.nvidia ||
          !supportsNvidiaTranslationPair(request.sourceLanguage, request.targetLanguage)
        ) {
          throw error;
        }
      }
    }

    if (
      request.consent.nvidia &&
      supportsNvidiaTranslationPair(request.sourceLanguage, request.targetLanguage)
    ) {
      try {
        const result = await this.options.nvidia.translate(request, signal);
        this.options.onFallback?.(true);
        return result;
      } catch (error) {
        this.options.onFallback?.(false);
        throw error;
      }
    }

    throw new TranslationAdapterError(
      "provider-unavailable",
      "No accepted provider can translate this language direction.",
      false,
    );
  }
}
