import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: path.join(testsDirectory, ".tmp", "playwright-results"),
  reporter: "line",
  testDir: path.join(testsDirectory, "e2e"),
  testMatch: "**/*.e2e.ts",
  timeout: 45_000,
  use: {
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @lingobridge/gateway start",
    cwd: path.resolve(testsDirectory, ".."),
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    url: "http://127.0.0.1:8787/v1/health",
  },
});
