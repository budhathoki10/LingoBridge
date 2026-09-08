import type { TranslationRequest, TranslationResult } from "@lingobridge/contracts";
import { supportsNvidiaTranslationPair } from "./nvidia-capabilities.js";
import { type TranslationAdapter, TranslationAdapterError } from "./translation-adapter.js";

export interface ProviderRouterOptions {
  google: TranslationAdapter | null;
  nvidia: TranslationAdapter;
}

export class NvidiaPrimaryProviderRouter implements TranslationAdapter {
  constructor(private readonly options: ProviderRouterOptions) {}

  async translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    if (
      request.consent.nvidia &&
      supportsNvidiaTranslationPair(request.sourceLanguage, request.targetLanguage)
    ) {
      try {
        return await this.options.nvidia.translate(request, signal);
      } catch (error) {
        if (!request.consent.googleBackup || !this.options.google) throw error;
      }
    }

    if (request.consent.google && this.options.google) {
      return this.options.google.translate(request, signal);
    }

    throw new TranslationAdapterError(
      "provider-unavailable",
      "No accepted provider can translate this language direction.",
      false,
    );
  }
}
