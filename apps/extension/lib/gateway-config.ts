/**
 * Where the extension sends every translation, explanation and capability
 * request.
 *
 * This is compiled into `host_permissions` and into the gateway client's base
 * URL, so a published package can only ever reach this origin. Changing it
 * requires a rebuild and a new store version.
 *
 * To run against a local gateway, change this to http://127.0.0.1:8787.
 */
export const GATEWAY_ORIGIN = "https://lingobridge-gateway.onrender.com";
