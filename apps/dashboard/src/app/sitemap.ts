import type { MetadataRoute } from "next";
import { loadDashboardOrigin } from "@/server/config";

// Only the pages whose metadata allows indexing. Everything else is signed-in or noindex.
const PUBLIC_PATHS = ["/", "/privacy-policy"] as const;

// Read at request time so the deployed origin is configuration, not a build-time value.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = loadDashboardOrigin(process.env);
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, origin).toString() }));
}
