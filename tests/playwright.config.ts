import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const E2E_METRICS_TOKEN = "e2e-operations-metrics-token-0000000000";

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
  webServer: [
    {
      command: "pnpm --filter @lingobridge/gateway start",
      cwd: path.resolve(testsDirectory, ".."),
      env: { LINGOBRIDGE_OPERATIONS_METRICS_TOKEN: E2E_METRICS_TOKEN },
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      url: "http://127.0.0.1:8787/v1/health",
    },
    {
      // Development mode is required: production refuses the local identity provider by design.
      command:
        "pnpm --filter @lingobridge/dashboard exec next dev --hostname 127.0.0.1 --port 3000",
      cwd: path.resolve(testsDirectory, ".."),
      env: {
        // Blank values win over apps/dashboard/.env.local, so tests never reach a real database.
        DATABASE_NAME: "",
        DATABASE_URL: "",
        LINGOBRIDGE_ADMIN_EMAILS: "admin@example.test",
        LINGOBRIDGE_ALLOWED_EXTENSION_IDS: "*",
        LINGOBRIDGE_AUTH_MODE: "development",
        LINGOBRIDGE_DASHBOARD_ORIGIN: "http://127.0.0.1:3000",
        LINGOBRIDGE_EMBEDDED_DATABASE_DIR: "memory",
        LINGOBRIDGE_OPERATIONS_METRICS_TOKEN: E2E_METRICS_TOKEN,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      url: "http://127.0.0.1:3000/sign-in",
    },
  ],
});
