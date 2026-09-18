/**
 * Where the extension expects the dashboard to live.
 *
 * This is compiled into `host_permissions` and into every dashboard request, so a
 * published package can only ever talk to this origin. Changing it requires a
 * rebuild and a new store version.
 *
 * No trailing slash: account-background.ts compares this against `URL.origin`,
 * which never carries one, and a mismatch rejects every sign-in.
 *
 * To run against a local dashboard, change this to http://127.0.0.1:3000.
 */
export const DASHBOARD_ORIGIN = "https://lingobridge.kushalbudhathoki.com.np";
