/**
 * Builds the extension package for the Chrome Web Store.
 *
 * The deployed origins live here rather than in a `.env` file on purpose. WXT
 * loads `.env` files for the bundled code but not for `wxt.config.ts`, which runs
 * in Node and produces `host_permissions`. A `.env.production` therefore yields a
 * package whose code calls the deployed origins while its manifest only permits
 * localhost, and Chrome blocks every request. Real environment variables reach
 * both, so they are set here before WXT starts.
 *
 * These are public URLs, not secrets: they are readable in the published
 * manifest and bundle.
 *
 * Changing either value requires a rebuild and a new store version, because both
 * are compiled into `host_permissions` and cannot be altered after packaging.
 *
 * `pnpm dev:extension` is unaffected and keeps using the 127.0.0.1 defaults in
 * lib/dashboard-config.ts and lib/gateway-config.ts.
 */
import { spawnSync } from "node:child_process";

const ORIGINS = {
  WXT_DASHBOARD_ORIGIN: "https://lingobridge.kushalbudhathoki.com.np",
  WXT_GATEWAY_ORIGIN: "https://lingobridge-gateway.onrender.com",
};

// An explicit override wins, so a staging origin can be built without editing this file.
const environment = { ...process.env };
for (const [name, value] of Object.entries(ORIGINS)) {
  environment[name] ??= value;
  console.info(`${name}=${environment[name]}`);
}

const result = spawnSync("pnpm", ["--filter", "@lingobridge/extension", "build"], {
  env: environment,
  shell: true,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
