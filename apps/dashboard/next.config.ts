import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard is opened at 127.0.0.1 locally; this lets dev hot reload connect. Dev only.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Keeps a visited dashboard page in the browser for 30 seconds, so going back to it is instant.
    // Every dashboard mutation calls router.refresh(), which clears this cache.
    staleTimes: { dynamic: 30 },
  },
  poweredByHeader: false,
  reactStrictMode: true,
  // Database drivers load native or WebAssembly assets at runtime and must not be bundled.
  serverExternalPackages: ["mongodb", "mongodb-memory-server-core"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
