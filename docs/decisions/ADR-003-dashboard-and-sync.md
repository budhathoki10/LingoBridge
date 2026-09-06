# ADR-003: Dashboard, accounts, and phrase synchronization

Status: **Accepted for architecture; identity provider selection pending**
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

## Authentication boundary

The dashboard uses secure web sessions. The extension uses its own short-lived access token and rotating revocable session; it does not copy dashboard cookies. Interactive extension sign-in starts only after the user clicks Connect dashboard. Provider tokens and LingoBridge signing secrets never enter webpage content or logs.

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

## Open decision

Select the OAuth or OpenID Connect provider only after comparing extension compatibility, account deletion, session revocation, cost, regional availability, and privacy terms.

## Primary source

- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
