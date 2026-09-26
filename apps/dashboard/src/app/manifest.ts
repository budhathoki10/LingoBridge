import type { MetadataRoute } from "next";
import { BRAND_BACKGROUND, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// Installable without a service worker on purpose: every dashboard page is signed-in data, and
// an offline cache could show one account's phrases after another signs in on the same browser.
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: BRAND_BACKGROUND,
    categories: ["productivity", "education", "utilities"],
    description: SITE_DESCRIPTION,
    display: "standalone",
    icons: [
      { sizes: "any", src: "/icon.svg", type: "image/svg+xml" },
      { sizes: "192x192", src: "/icons/icon-192.png", type: "image/png" },
      { sizes: "512x512", src: "/icons/icon-512.png", type: "image/png" },
      { purpose: "maskable", sizes: "192x192", src: "/icons/maskable-192.png", type: "image/png" },
      { purpose: "maskable", sizes: "512x512", src: "/icons/maskable-512.png", type: "image/png" },
    ],
    id: "/",
    lang: "en",
    name: SITE_NAME,
    scope: "/",
    short_name: SITE_NAME,
    start_url: "/overview",
    theme_color: BRAND_BACKGROUND,
  };
}
