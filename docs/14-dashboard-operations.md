# Dashboard operations

Status: **Local implementation and automated verification complete; production configuration and credentialed smoke tests pending.**

## Production configuration

Create a Google OAuth **Web application** client. Register the exact HTTPS dashboard callback
`https://YOUR_DASHBOARD_ORIGIN/auth/callback` with Google. Set these values in the deployment's
secret and configuration store, outside the repository:

| Variable | Purpose |
| --- | --- |
| `LINGOBRIDGE_DASHBOARD_ORIGIN` | Exact HTTPS dashboard origin, with no path. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Google web-client credentials. Both are required in production. |
| `OIDC_ISSUER` | Optional; defaults to `https://accounts.google.com`. |
| `DATABASE_URL` | MongoDB Atlas `mongodb+srv://` connection string for a `readWrite`-only database user. |
| `DATABASE_NAME` | Optional; defaults to `lingobridge`. |
| `LINGOBRIDGE_SESSION_SECRET` | Random secret of at least 32 characters. |
| `LINGOBRIDGE_ALLOWED_EXTENSION_IDS` | Comma-separated exact IDs of reviewed extension packages. |
| `LINGOBRIDGE_GATEWAY_URL` | Deployed gateway origin for the admin operations view. |
| `LINGOBRIDGE_OPERATIONS_METRICS_TOKEN` | Shared server-only metrics token on the dashboard and gateway. |
| `LINGOBRIDGE_ADMIN_EMAILS` | Optional verified email allowlist for admin role at sign-in. |

The extension's `DASHBOARD_ORIGIN` and gateway origin are build-time constants. Set them to the
deployed origins before packaging, then allowlist the resulting extension ID at the dashboard and
gateway. Never put an OIDC client secret, database URL, session secret, or provider key in the
extension. Translation and local saving continue without any dashboard configuration.

## Local Google sign-in

Copy `apps/dashboard/.env.example` to `apps/dashboard/.env.local` (git-ignored), create a Google
OAuth Web application client with the redirect URI `http://127.0.0.1:3000/auth/callback`, and fill
in its client ID and secret. Restart `pnpm dev:dashboard` and open `http://127.0.0.1:3000`, not
`localhost`: the extension's `DASHBOARD_ORIGIN` and the session cookie are bound to that origin.

## Database and retention

The dashboard runs append-only migrations when it opens the database, creating collections,
validators, and indexes. Restrict Atlas network access to the dashboard deployment. Back up the
Atlas cluster before deploying a new migration; verify restoration against a separate database before release.
Account deletion immediately removes synchronized phrase content and preferences, revokes web and
extension sessions, de-identifies the account, and issues a content-free receipt. The de-identified
account row is due for purge after 30 days. Phrase tombstones are retained for 30 days so offline
clients receive deletions, while mutation receipts are retained for seven days.

Run maintenance at least daily from a scheduler with the same `DATABASE_URL` and a deployment
identity that can delete expired records:

```powershell
pnpm build:packages
pnpm --filter @lingobridge/dashboard maintenance
```

The command purges expired login attempts and connection codes, sync tombstones and mutation
receipts, and due de-identified accounts. It outputs only the count of purged accounts. The
deployment must alert on a failed run; a successful local command does not prove the scheduler is
configured. Database backups and their retention must be reviewed separately for account-deletion
promises before release.

## Search and sharing

Status: **Implemented and tested locally; not yet verified on the production domain.**

`LINGOBRIDGE_DASHBOARD_ORIGIN` also drives the public search and sharing routes. Canonical links,
Open Graph and X images, `sitemap.xml`, `robots.txt`, `llms.txt`, and the landing page's JSON-LD
all use that origin. Only `/` and `/privacy-policy` are indexable; every other page inherits
`noindex` from the root layout. `robots.txt` allows crawling only when the request's host matches
the configured origin, so a second site or preview serving the same build answers `Disallow: /`.
Signed-in pages stay crawlable so crawlers see their `noindex`; only `/api/`, `/auth/`, and
`/dev-identity/` are excluded.

The web app manifest makes the dashboard installable without a service worker, so no signed-in
data is cached for offline use. The PNG icons, maskable icons, and `favicon.ico` are generated from
the brand mark in `@lingobridge/design-tokens/brand`; run `pnpm --filter @lingobridge/dashboard icons`
after changing it and commit the output. Share images use the static IBM Plex Sans instances in
`apps/dashboard/src/assets/fonts` (SIL Open Font License, included).

After deployment, submit `https://YOUR_DASHBOARD_ORIGIN/sitemap.xml` in Google Search Console,
inspect the landing page with the Rich Results Test, and check a shared link in a social preview
debugger.

## Deployment verification

With deployment credentials, verify a Google sign-in, failed-login handling, re-authentication,
callback allowlist, sign-out, and session expiry. Connect the exact packaged extension through
Chrome Identity from a signed-out browser profile as well as a signed-in profile. Chrome documents
`launchWebAuthFlow` as a web-view flow for non-Google providers, and Google restricts embedded
OAuth user agents; whether this Google dashboard sign-in works in that window is unresolved until
the credentialed check. If it fails, use a normal browser-tab sign-in handoff or a compatible OIDC
issuer before release. Then save one phrase, observe it on the dashboard, edit and delete it, revoke that
installation, and confirm its next sync fails. Exercise export and account deletion, then verify
the receipt and the scheduled purge after its due date. Confirm the admin view contains only
aggregate metadata and ordinary users cannot access it. Record these results with the release
evidence; no production credentials are needed for local automated tests.
