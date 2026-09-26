import "server-only";
import { capabilityCatalogueSchema, GATEWAY_ROUTES } from "@lingobridge/contracts";

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string | null;
}

let cache: { expiresAt: number; options: LanguageOption[] } | undefined;

/**
 * Preferred-language choices come from the gateway's live capability catalogue, never a hard-coded
 * list. When the gateway is unreachable the caller shows a code field instead of guessing.
 */
export async function loadTargetLanguages(gatewayUrl: string): Promise<LanguageOption[] | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.options;
  try {
    // The catalogue is public and changes rarely. Next's data cache shares it across server
    // instances, so a fresh instance doesn't wait on a gateway that may be waking from sleep.
    // Only successful responses are cached.
    const response = await fetch(`${gatewayUrl}${GATEWAY_ROUTES.capabilities}`, {
      headers: { "X-LingoBridge-Installation-Id": "00000000-0000-4000-8000-000000000000" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return cache?.options ?? null;
    const parsed = capabilityCatalogueSchema.safeParse(await response.json());
    if (!parsed.success) return cache?.options ?? null;
    const targets = new Set(parsed.data.directions.map((direction) => direction.targetLanguage));
    const options = parsed.data.languages
      .filter(
        (language) =>
          language.myMemoryTarget || language.googleTarget || targets.has(language.code),
      )
      .map((language) => ({
        code: language.code,
        name: language.name,
        nativeName: language.nativeName,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    cache = { expiresAt: Date.now() + 10 * 60 * 1_000, options };
    return options;
  } catch {
    return cache?.options ?? null;
  }
}
