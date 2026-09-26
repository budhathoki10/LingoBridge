import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SITE_NAME, sharedOpenGraph, sharedTwitter, siteOrigin } from "@/lib/site";
import "@fontsource-variable/roboto";
import "@lingobridge/design-tokens/tokens.css";
import "@lingobridge/design-tokens/tokens-dark.css";
import "./globals.css";
import "./app.css";

// Private by default: only the public pages opt back in to indexing. The origin is read here, not
// hard-coded, so canonical and share-image URLs follow the deployment's configuration.
export function generateMetadata(): Metadata {
  const origin = siteOrigin();
  return {
    appleWebApp: { statusBarStyle: "default", title: SITE_NAME },
    applicationName: SITE_NAME,
    description:
      "Manage phrases you deliberately saved from LingoBridge and the extensions connected to your account.",
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: sharedOpenGraph,
    referrer: "strict-origin-when-cross-origin",
    robots: { follow: false, index: false },
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    twitter: sharedTwitter,
  };
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { color: "#fbfbfa", media: "(prefers-color-scheme: light)" },
    { color: "#111110", media: "(prefers-color-scheme: dark)" },
  ],
  width: "device-width",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
