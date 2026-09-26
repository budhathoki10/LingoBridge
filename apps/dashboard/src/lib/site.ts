import type { MetadataRoute } from "next";
import { loadDashboardOrigin } from "../server/config";
import { CHROME_WEB_STORE_URL, CREATOR, GITHUB_REPOSITORY_URL } from "./links";

// Relative imports only: the Vitest suite imports this module without the "@/" path alias.

export const SITE_NAME = "LingoBridge";
export const SITE_TAGLINE = "Understand the words in front of you.";
/** Leads with the phrase people search for ("LingoBridge Chrome extension"). */
export const SITE_TITLE = "LingoBridge Chrome Extension: Translate Selected Text";
/**
 * A self-contained definition. Several unrelated products share the LingoBridge name, so this
 * sentence says exactly which one this is; answer engines tend to quote it as written.
 */
export const SITE_DESCRIPTION =
  "LingoBridge is a free Chrome extension that translates the text you select right beside it, including English to Nepali. Save only the phrases you choose.";
/** Other names people use for this product, for structured data only. */
export const SITE_ALTERNATE_NAMES = ["LingoBridge Chrome Extension", "LingoBridge for Chrome"];

/** Capabilities stated on the landing page, listed for structured data. Keep in step with it. */
export const SITE_FEATURES = [
  "Translates the text you select, beside it on the same page",
  "English to Nepali and the other languages in the reviewed provider catalogue",
  "Translation starts only after you click the Selection Magic action",
  "Copy, listen to, or replace editable text with the result",
  "Saves only the phrases and vocabulary you choose to a private dashboard",
];

/** Brand surface colours, matching the design tokens and the viewport theme colour. */
export const BRAND_ACCENT = "#2363eb";
export const BRAND_BACKGROUND = "#fbfbfa";

/** Next.js replaces, not merges, a parent's openGraph and twitter objects, so pages spread these in. */
export const sharedOpenGraph = { locale: "en_US", siteName: SITE_NAME, type: "website" } as const;
export const sharedTwitter = { card: "summary_large_image" } as const;

/** Pages whose metadata allows indexing. Everything else is signed-in or noindex. */
export const INDEXABLE_PATHS = ["/", "/privacy-policy"] as const;

/** Never useful to a crawler: JSON endpoints, the sign-in handshake, and the local identity stub. */
const CRAWL_EXCLUDED_PREFIXES = ["/api/", "/auth/", "/dev-identity/"] as const;

/**
 * The configured public origin, or null where it is missing or invalid, such as a preview site
 * deployed without the dashboard settings. Public SEO routes fall back to "do not index" then.
 */
export function siteOrigin(environment = process.env): string | null {
  try {
    return loadDashboardOrigin(environment);
  } catch {
    return null;
  }
}

/**
 * Crawling is allowed only on the configured origin. Any other host serving the same build (a
 * second Netlify site, a deploy preview alias) is refused so it never competes with the canonical.
 * Signed-in pages stay crawlable on purpose: they redirect to a noindex sign-in page, and a
 * robots.txt block would hide that noindex from crawlers.
 */
export function robotsFor(origin: string | null, requestHost: string | null): MetadataRoute.Robots {
  if (!origin || (requestHost !== null && new URL(origin).host !== requestHost)) {
    return { rules: { disallow: "/", userAgent: "*" } };
  }
  return {
    rules: { allow: "/", disallow: [...CRAWL_EXCLUDED_PREFIXES], userAgent: "*" },
    sitemap: new URL("/sitemap.xml", origin).toString(),
  };
}

export function sitemapFor(origin: string | null): MetadataRoute.Sitemap {
  if (!origin) return [];
  return INDEXABLE_PATHS.map((path) => ({ url: new URL(path, origin).toString() }));
}

export interface FaqEntry {
  answer: string;
  question: string;
}

/**
 * JSON-LD for the landing page. Every value mirrors visible page copy: no ratings, review counts,
 * or language counts that the page itself does not show.
 */
export function landingStructuredData(origin: string, faqs: readonly FaqEntry[]) {
  const url = (path: string) => new URL(path, origin).toString();
  const organization = `${url("/")}#organization`;
  const website = `${url("/")}#website`;
  const application = `${url("/")}#software`;
  const creator = `${url("/")}#creator`;
  // The store listing and the source repository are the same product; saying so links them into
  // one entity instead of leaving search engines to guess among same-named products.
  const sameAs = [CHROME_WEB_STORE_URL, GITHUB_REPOSITORY_URL];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": organization,
        "@type": "Organization",
        founder: { "@id": creator },
        logo: url("/icons/icon-512.png"),
        name: SITE_NAME,
        sameAs,
        url: url("/"),
      },
      {
        "@id": creator,
        "@type": "Person",
        name: CREATOR.name,
        url: CREATOR.url,
      },
      {
        "@id": website,
        "@type": "WebSite",
        alternateName: SITE_ALTERNATE_NAMES,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        name: SITE_NAME,
        publisher: { "@id": organization },
        url: url("/"),
      },
      {
        "@id": application,
        "@type": "SoftwareApplication",
        alternateName: SITE_ALTERNATE_NAMES,
        applicationCategory: "BrowserApplication",
        applicationSubCategory: "Translation",
        author: { "@id": creator },
        description: SITE_DESCRIPTION,
        downloadUrl: CHROME_WEB_STORE_URL,
        featureList: SITE_FEATURES,
        image: url("/opengraph-image"),
        installUrl: CHROME_WEB_STORE_URL,
        isAccessibleForFree: true,
        name: SITE_NAME,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        operatingSystem: "Chrome",
        publisher: { "@id": organization },
        sameAs,
        url: url("/"),
      },
      {
        "@id": `${url("/")}#webpage`,
        "@type": "WebPage",
        about: { "@id": application },
        description: SITE_DESCRIPTION,
        isPartOf: { "@id": website },
        name: SITE_TITLE,
        url: url("/"),
      },
      {
        "@id": `${url("/")}#faq`,
        "@type": "FAQPage",
        isPartOf: { "@id": website },
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
          name: faq.question,
        })),
      },
    ],
  };
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so text cannot close it. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</gu, "\\u003c");
}
