import { serializeJsonLd } from "@/lib/site";

/**
 * A JSON-LD data block. Browsers never execute application/ld+json, so the nonce-based
 * Content-Security-Policy does not apply to it.
 */
export function StructuredData({ data }: { data: unknown }) {
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be raw JSON, and serializeJsonLd escapes "<"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
      type="application/ld+json"
    />
  );
}
