/**
 * Where the packaged extension expects the dashboard to live.
 *
 * This is compiled into `host_permissions` and into every dashboard request, so a
 * published package can only ever talk to the origin baked in here. Changing it
 * after packaging is impossible — it requires a rebuild and a new store version.
 *
 * `WXT_DASHBOARD_ORIGIN` overrides it at build time. Without that override the
 * build targets the local dev server, so `pnpm dev:extension` keeps working
 * unchanged.
 *
 * The trailing slash is stripped because this value is compared against
 * `URL.origin` in account-background.ts, and `URL.origin` never carries one.
 */
const LOCAL_DASHBOARD_ORIGIN = "http://127.0.0.1:3000";

export const DASHBOARD_ORIGIN = (
  import.meta.env.WXT_DASHBOARD_ORIGIN ?? LOCAL_DASHBOARD_ORIGIN
).replace(/\/+$/u, "");
