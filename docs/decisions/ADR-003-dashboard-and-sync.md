# ADR-003: Dashboard, accounts, and phrase synchronization

Status: **Accepted; Phase 8 implemented and verified locally with development identity; credentialed Google sign-in remains deployment evidence**
Decision date: **6 September 2026**

## Context

LingoBridge requires both a Chrome extension and a web dashboard. A separate dashboard is useful only when it can securely access user-owned data across sessions. That introduces accounts, cloud storage, synchronization, authorization, deletion, and new privacy obligations.

## Decision

- Make the authenticated user dashboard a required product surface.
- Keep translation and local saving available without an account.
- Require sign-in only for dashboard access and cloud synchronization.
- Synchronize only explicitly saved phrases and approved preferences.
- Never create automatic cloud translation history.
- Connect the extension through an interactive Chrome identity flow using authorization code with PKCE.
- Give each extension installation its own revocable session.
- Keep site permissions, disabled sites, sensitive-text decisions, and local-model state on the device.
- Store user-owned synchronized records in a PostgreSQL-compatible database with strict ownership checks.
- Include a server-role-protected admin operations view containing content-free aggregates only.
- Use Google OpenID Connect for version 1 dashboard sign-in. The dashboard is the confidential
  OAuth client; the extension receives only a separate LingoBridge authorization code after the
  signed-in user approves its connection. Keep the OIDC client configurable so the protocol
  boundary does not depend on a Google SDK.

## Authentication boundary

The dashboard uses secure web sessions. The extension uses its own short-lived access token and rotating revocable session; it does not copy dashboard cookies. Interactive extension sign-in starts only after the user clicks Connect dashboard. Provider tokens and LingoBridge signing secrets never enter webpage content or logs.

Signing out of the dashboard ends that web session and revokes every extension session on the account in the same transaction (amended 14 September 2026). An extension never keeps syncing for someone who signed out; it learns at its next sync, which also runs when the popup opens, and then offers to keep or delete its local phrases. Web sessions in other browsers are unaffected, and replacing a session by signing in again does not revoke extensions.

## Data boundary

Cloud data may contain account details, explicitly saved source and translated text, approved preferences, extension-session metadata, deletion state, and content-free operational aggregates. Unsaved translation text, webpage history, site permissions, and complete IP addresses are excluded.

## Consequences

The product gains cross-device phrase access and user-controlled account management but now requires authentication, database migrations, tenant isolation, sync conflict handling, export, deletion, incident response, and a stronger privacy policy. Dashboard work must be completed and tested before release rather than treated as a later optional add-on.

## Rejected alternatives

### Dashboard without accounts

A normal website cannot safely read another extension installation's local storage, so it would not provide reliable cross-device value.

### Automatic translation history

It would collect substantially more sensitive text than the dashboard needs.

### Shared browser cookies

Extension sessions need an explicit revocable boundary and must not depend on copying dashboard cookies.

### Admin access to phrase content

Operational troubleshooting should use metadata and controlled diagnostics, not routine access to user text.

## Identity-provider choice and deployment boundary

Google OpenID Connect is the version 1 choice. Its standard authorization-code endpoint supports
the dashboard's PKCE, state, and nonce flow; the extension uses Chrome Identity only for the
LingoBridge connection code and therefore needs no Google token. LingoBridge stores the verified
issuer and subject, not Google access or refresh tokens. Deleting a LingoBridge account removes its
LingoBridge data and sessions; it does not delete the user's Google account. The core translator and
local phrase saving remain available to people without a Google account. A hosted identity broker
would add another processor and cost boundary without improving this first release.

Production requires a Google web-application client ID and secret, the exact dashboard callback
URI, HTTPS, a PostgreSQL database, exact extension IDs, and a session secret supplied outside the
repository. Credentialed sign-in, regional availability, privacy terms, and real callback handling
must be checked with the selected production Google project before release. The local development
identity provider is forbidden in production.

One compatibility assumption remains open: Chrome describes `launchWebAuthFlow` as a web-view flow
for non-Google identity providers, while Google's OAuth policy forbids developer-controlled
embedded user agents. The signed-out, first-time extension connection must be tested with the
actual Google client and packaged extension. If Google rejects that window, move the Google sign-in
step to a normal browser tab or choose a compatible OIDC provider before release; do not weaken
the PKCE or extension-session boundary.

## Primary source

- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference)
- [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies)
