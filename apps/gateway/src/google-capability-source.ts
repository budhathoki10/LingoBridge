import { createHash } from "node:crypto";
import {
  type CapabilityCatalogue,
  capabilityCatalogueSchema,
  type LanguageCapability,
  languageCodeSchema,
} from "@lingobridge/contracts";
import type {
  GoogleCapabilityClient,
  GoogleSupportedLanguagesResponse,
} from "./google-translation-adapter.js";

export class CapabilitySourceError extends Error {
  constructor() {
    super("Google capability metadata is unavailable.");
    this.name = "CapabilitySourceError";
  }
}

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

function normalizeLanguages(response: GoogleSupportedLanguagesResponse): LanguageCapability[] {
  if (!Array.isArray(response.languages) || response.languages.length === 0) {
    throw new CapabilitySourceError();
  }

  const byCode = new Map<string, LanguageCapability>();
  for (const candidate of response.languages) {
    const code = languageCodeSchema.safeParse(candidate.languageCode);
    const name = candidate.displayName?.trim();
    if (
      !code.success ||
      !name ||
      name.length > 100 ||
      typeof candidate.supportSource !== "boolean" ||
      typeof candidate.supportTarget !== "boolean" ||
      (!candidate.supportSource && !candidate.supportTarget)
    ) {
      throw new CapabilitySourceError();
    }

    const existing = byCode.get(code.data);
    byCode.set(code.data, {
      code: code.data,
      googleSource: candidate.supportSource || Boolean(existing?.googleSource),
      googleTarget: candidate.supportTarget || Boolean(existing?.googleTarget),
      name,
      nativeName: nativeLanguageName(code.data, name),
      textDirection: textDirection(code.data),
    });
  }

  return [...byCode.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en") || left.code.localeCompare(right.code),
  );
}

function contentVersion(languages: readonly LanguageCapability[]): string {
  const content = JSON.stringify(
    languages.map(
      ({ code, googleSource, googleTarget, name, nativeName, textDirection: direction }) => ({
        code,
        direction,
        googleSource,
        googleTarget,
        name,
        nativeName,
      }),
    ),
  );
  return `google-nmt-${createHash("sha256").update(content).digest("hex").slice(0, 24)}`;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Capability refresh cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const handleAbort = () =>
      reject(new DOMException("Capability refresh cancelled", "AbortError"));
    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", handleAbort));
  });
}

export class GoogleCapabilitySource {
  private readonly model: string;
  private readonly parent: string;

  constructor(
    private readonly client: GoogleCapabilityClient,
    projectId: string,
    private readonly timeoutMilliseconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.parent = `projects/${projectId}/locations/global`;
    this.model = `${this.parent}/models/general/nmt`;
  }

  async fetch(signal: AbortSignal): Promise<CapabilityCatalogue> {
    let response: GoogleSupportedLanguagesResponse;
    try {
      response = await abortable(
        this.client.getSupportedLanguages(
          {
            displayLanguageCode: "en",
            model: this.model,
            parent: this.parent,
          },
          this.timeoutMilliseconds,
        ),
        signal,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new CapabilitySourceError();
    }

    const languages = normalizeLanguages(response);
    const verifiedAt = this.now().toISOString();
    return capabilityCatalogueSchema.parse({
      catalogueVersion: contentVersion(languages),
      directions: [],
      freshness: "fresh",
      generatedAt: verifiedAt,
      googlePairing: "all-listed",
      languages,
      source: "google-nmt",
      verifiedAt,
    });
  }
}
