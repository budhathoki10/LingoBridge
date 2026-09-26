import type { MetadataRoute } from "next";
import { sitemapFor, siteOrigin } from "@/lib/site";

// Read at request time so the deployed origin is configuration, not a build-time value.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapFor(siteOrigin());
}
