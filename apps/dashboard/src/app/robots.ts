import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { robotsFor, siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return robotsFor(siteOrigin(), host);
}
