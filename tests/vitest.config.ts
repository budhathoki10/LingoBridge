import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The first run downloads the MongoDB server binary used by the embedded test database.
    globalSetup: ["./support/mongodb-global-setup.ts"],
    hookTimeout: 60_000,
  },
});
