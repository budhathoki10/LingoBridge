/**
 * Where the packaged extension sends every translation, explanation and
 * capability request.
 *
 * This is compiled into `host_permissions` and into the gateway client's base
 * URL, so a published package can only ever reach the origin baked in here.
 *
 * `WXT_GATEWAY_ORIGIN` overrides it at build time. Without that override the
 * build targets the local gateway, so `pnpm dev:extension` keeps working
 * unchanged.
 */
const LOCAL_GATEWAY_ORIGIN = "http://127.0.0.1:8787";

export const GATEWAY_ORIGIN = (
  import.meta.env.WXT_GATEWAY_ORIGIN ?? LOCAL_GATEWAY_ORIGIN
).replace(/\/+$/u, "");
