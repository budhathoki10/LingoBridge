import { describe, expect, it } from "vitest";
import {
  CHROME_WEB_STORE_URL,
  CREATOR,
  GITHUB_REPOSITORY_URL,
} from "../../apps/dashboard/src/lib/links";
import {
  INDEXABLE_PATHS,
  landingStructuredData,
  robotsFor,
  SITE_DESCRIPTION,
  SITE_TITLE,
  serializeJsonLd,
  sitemapFor,
  siteOrigin,
} from "../../apps/dashboard/src/lib/site";

describe("landing copy", () => {
  it("leads the title with the phrase people search for, within the length Google shows", () => {
    expect(SITE_TITLE.startsWith("LingoBridge Chrome Extension")).toBe(true);
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
  });

  it("opens the description with a self-contained definition that fits a result snippet", () => {
    expect(SITE_DESCRIPTION.startsWith("LingoBridge is a free Chrome extension")).toBe(true);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
});

import { isProtectedPath, PROTECTED_PREFIXES } from "../../apps/dashboard/src/proxy";

const ORIGIN = "https://lingobridge.example";

describe("siteOrigin", () => {
  it("returns the configured origin", () => {
    expect(siteOrigin({ LINGOBRIDGE_DASHBOARD_ORIGIN: `${ORIGIN}/`, NODE_ENV: "production" })).toBe(
      ORIGIN,
    );
  });

  it("returns null instead of throwing when production has no valid origin", () => {
    expect(siteOrigin({ NODE_ENV: "production" })).toBeNull();
    expect(
      siteOrigin({
        LINGOBRIDGE_DASHBOARD_ORIGIN: "http://insecure.example",
        NODE_ENV: "production",
      }),
    ).toBeNull();
  });
});

describe("robotsFor", () => {
  it("allows crawling on the configured host and points to the sitemap", () => {
    const robots = robotsFor(ORIGIN, "lingobridge.example");
    expect(robots.sitemap).toBe(`${ORIGIN}/sitemap.xml`);
    expect(robots.rules).toEqual({
      allow: "/",
      disallow: ["/api/", "/auth/", "/dev-identity/"],
      userAgent: "*",
    });
  });

  it("keeps signed-in pages crawlable so crawlers can see their noindex", () => {
    const rules = robotsFor(ORIGIN, "lingobridge.example").rules;
    const disallowed = Array.isArray(rules) ? [] : [rules.disallow ?? []].flat();
    for (const prefix of PROTECTED_PREFIXES) {
      expect(disallowed.some((path) => prefix.startsWith(path))).toBe(false);
    }
  });

  it("refuses every crawler on another host or without a configured origin", () => {
    const blocked = { rules: { disallow: "/", userAgent: "*" } };
    expect(robotsFor(ORIGIN, "deploy-preview-1--site.netlify.app")).toEqual(blocked);
    expect(robotsFor(null, "lingobridge.example")).toEqual(blocked);
  });
});

describe("sitemapFor", () => {
  it("lists only the indexable public pages on the configured origin", () => {
    expect(sitemapFor(ORIGIN)).toEqual([
      { url: `${ORIGIN}/` },
      { url: `${ORIGIN}/privacy-policy` },
    ]);
    expect(INDEXABLE_PATHS.filter(isProtectedPath)).toEqual([]);
  });

  it("is empty when no origin is configured", () => {
    expect(sitemapFor(null)).toEqual([]);
  });
});

describe("landingStructuredData", () => {
  const faqs = [{ answer: "Yes.", question: "Is it free?" }];
  const graph = landingStructuredData(ORIGIN, faqs)["@graph"];
  const byType = (type: string) => graph.find((node) => node["@type"] === type);

  it("describes the extension without invented ratings or counts", () => {
    const application = byType("SoftwareApplication");
    expect(application).toMatchObject({
      applicationCategory: "BrowserApplication",
      installUrl: CHROME_WEB_STORE_URL,
      offers: { price: "0" },
      operatingSystem: "Chrome",
    });
    expect(application).not.toHaveProperty("aggregateRating");
  });

  it("mirrors the visible FAQ entries", () => {
    expect(byType("FAQPage")).toMatchObject({
      mainEntity: [{ acceptedAnswer: { "@type": "Answer", text: "Yes." }, name: "Is it free?" }],
    });
  });

  it("ties the store listing, source, and maker to one entity", () => {
    const sameAs = [CHROME_WEB_STORE_URL, GITHUB_REPOSITORY_URL];
    expect(byType("SoftwareApplication")).toMatchObject({
      author: { "@id": `${ORIGIN}/#creator` },
      sameAs,
    });
    expect(byType("Organization")).toMatchObject({
      founder: { "@id": `${ORIGIN}/#creator` },
      sameAs,
    });
    expect(byType("Person")).toMatchObject({
      "@id": `${ORIGIN}/#creator`,
      name: CREATOR.name,
      url: CREATOR.url,
    });
  });

  it("uses absolute URLs on the configured origin", () => {
    expect(byType("Organization")).toMatchObject({
      logo: `${ORIGIN}/icons/icon-512.png`,
      url: `${ORIGIN}/`,
    });
  });
});

describe("serializeJsonLd", () => {
  it("escapes angle brackets so text cannot close the script element", () => {
    const serialized = serializeJsonLd({ text: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual({ text: "</script><script>alert(1)</script>" });
  });
});
