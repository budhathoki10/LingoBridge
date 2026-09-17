import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/roboto";
import "@lingobridge/design-tokens/tokens.css";
import "@lingobridge/design-tokens/tokens-dark.css";
import "./globals.css";
import "./app.css";

export const metadata: Metadata = {
  description:
    "Manage phrases you deliberately saved from LingoBridge and the extensions connected to your account.",
  referrer: "strict-origin-when-cross-origin",
  robots: { follow: false, index: false },
  title: { default: "LingoBridge", template: "%s · LingoBridge" },
};

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
