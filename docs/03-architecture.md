# System architecture

## Architecture goals

- Keep the visible product small and responsive.
- Expose the current active provider capability catalogue without hard-coding a language count.
- Use Chrome's on-device translation when a language pair is available.
- Route online translations through a protected gateway with NVIDIA Riva Translate 4B Instruct v2 as primary for reviewed supported directions.
- Use Google Cloud Translation as an optional backup when configured.
- Keep provider choice replaceable.
- Minimize permissions and data retention.

## Components

### Extension action popup

Provides pasted-text translation, language choices, style selection, result review, saved phrases, privacy state, and settings access.

### Context-menu entry

Receives only the text the user selected and starts the translation flow. It remains a fallback when Instant Selection is disabled or site access is unavailable.

### Selection observer

Runs only on sites where the user granted access. It reacts to completed pointer or keyboard selections, waits for a short stability interval, validates the active range, and emits one event for a new eligible selection. It does not crawl the DOM, index page text, or continuously transmit selections.

### Anchored translator overlay

Shows source and translated text near the selection. It runs in an isolated extension world and mounts its interface inside a closed Shadow DOM with an explicit style reset. Page-derived and provider-derived content is rendered as plain text. Positioning keeps the surface inside the viewport and responds to scrolling, resizing, zoom, and selection loss.

### Background service worker

Coordinates context-menu events, short-lived selection handoff, settings, provider routing metadata, rate limits, and extension lifecycle events. It does not perform Chrome on-device translation because the Translator API is unavailable in Web Workers.

### Translation document

The popup or another extension-owned document performs on-device language detection and translation. It reports model availability and download progress to the user.

### Translation gateway

A backend endpoint handles Online mode. It validates requests, applies limits, removes unnecessary operational metadata, and calls NVIDIA Riva Translate 4B Instruct v2 first for reviewed supported directions. If NVIDIA is unavailable or the direction is outside its reviewed support, the gateway may use Google Cloud Translation only when Google is configured, the pair is supported, and the user has consented to both providers. Provider credentials stay on the server.

The extension-facing contract is a LingoBridge-owned `POST /v1/translate` endpoint. The gateway's Google adapter uses Cloud Translation Advanced `translateText`. The NVIDIA adapter uses the selected NIM's server-side inference endpoint. These vendor details never become part of the extension contract.

### Capability registry

The gateway exposes `GET /v1/capabilities`. It normalizes Google's current supported-language catalogue and the reviewed NVIDIA language-pair tags into product capabilities. Google's general NMT all-supported-source-to-all-supported-target policy is encoded once with per-language source and target flags rather than expanded into tens of thousands of duplicate pair rows; providers with restricted pair matrices use exact direction records. Translation, fallback, transliteration, styles, speech, and on-device support remain separate flags. A versioned last-known-good snapshot prevents a provider metadata outage from emptying the language picker.

### Web dashboard

Provides an authenticated overview, synchronized saved phrases, search and language filters, safe preferences, connected extension sessions, export, and account deletion. A role-protected admin area shows aggregate provider health and usage metadata without translation content.

### Identity and session service

Authenticates dashboard users through an approved OAuth or OpenID Connect provider. The extension begins an interactive connection only after the user clicks Connect dashboard, uses Chrome's identity redirect flow with authorization code and PKCE, and receives a revocable extension session. Translation itself remains available without an account.

### Phrase sync service

Synchronizes only explicitly saved phrases and approved preferences. It uses stable record identifiers, revisions, idempotent writes, and deletion tombstones so retries do not duplicate records and deletions reach connected clients.

### Cloud database

A PostgreSQL-compatible database stores users, extension sessions, synchronized phrases, sync revisions, approved preferences, deletion state, and content-free operational aggregates. Every user-owned query is scoped by the authenticated user identifier. Complete translation history is not stored.

### Admin operations view

Shows request counts, provider, error category, latency, fallback rate, and quota state. It never exposes source text, translated text, saved phrases, access tokens, or secret values. Server-side roles protect every admin route and API operation.

### Local storage

Stores preferences, site-access choices, disabled-site rules, consent state, saved phrases, a bounded recent-language list, and pending sync operations. Guest data remains local. Signed-in users may enable synchronization for explicitly saved phrases and approved preferences. Site permissions, sensitive-text decisions, and local-model state never sync. Temporary selections use session-scoped storage and expire quickly.

## Data flow

### Instant-selection path

1. The user grants Instant Selection access for the current site or all normal websites.
2. The user completes a pointer or keyboard text selection.
3. The isolated selection observer waits for the range to remain stable and rejects ineligible or duplicate selections.
4. A local detector proposes the source language when available; otherwise detection is included in the approved online request.
5. The anchored translator opens immediately with source, target, and loading state.
6. If Online auto-translation consent exists and no sensitive-text warning triggers, the request follows the NVIDIA-first online path.
7. Otherwise the surface waits for explicit confirmation or offers On-device mode.
8. Closing the surface or selecting unrelated text clears the temporary selection state.

### On-device path

1. The user selects or enters text.
2. LingoBridge validates length and language choices.
3. The extension-owned document checks local language-pair availability.
4. Chrome downloads the required language model when needed and shows progress.
5. Chrome returns the translation locally.
6. LingoBridge displays the result and stores it only if the user chooses Save.

### Online path

1. The user selects or enters text.
2. LingoBridge explains that the chosen text will leave the device and verifies consent.
3. The extension sends text, language pair, and style to the gateway.
4. The gateway validates size, rate, origin metadata, consent, and supported languages.
5. The gateway calls NVIDIA when the reviewed pair is supported.
6. If NVIDIA fails or does not support the direction, the router checks whether Google backup is configured and consented.
7. When both checks pass, the gateway uses Google; otherwise it returns a safe failure.
8. The gateway returns the translation, actual provider, detected language, confidence, and warnings.
9. The extension displays the provider state and result.

### Capability path

1. The extension opens with its cached capability catalogue.
2. It requests the current version from the LingoBridge gateway.
3. The gateway returns normalized languages, exact directions, feature flags, and verification time.
4. The extension replaces its cache only after schema validation.
5. The interface enables only operations supported for the selected pair.

### Dashboard connection path

1. The user chooses Connect dashboard in the extension.
2. Chrome opens an interactive authorization flow using the extension-specific redirect URL and PKCE challenge.
3. The identity service authenticates the user and returns a one-time authorization code to Chrome's redirect URL.
4. The extension exchanges the code through the LingoBridge gateway for a short-lived access token and rotating extension session.
5. The dashboard and extension now reference the same user account without sharing dashboard cookies with webpage content.
6. The user can revoke that extension session from either surface.

### Saved-phrase sync path

1. The user explicitly chooses Save after reviewing a translation.
2. The extension commits the phrase locally first.
3. If sync is enabled, it sends an idempotent upsert with record identifier and revision.
4. The API verifies the account, validates and bounds the record, then stores it under that user.
5. The dashboard displays the synchronized phrase.
6. Edits and deletions create new revisions; deletion tombstones propagate before final retention expiry.

### Dashboard deletion path

1. The user requests export, phrase deletion, session revocation, or account deletion from an authenticated dashboard.
2. Destructive account deletion requires re-authentication and explicit confirmation.
3. The API marks data for deletion, revokes extension sessions, and returns a deletion receipt.
4. The extension signs out and keeps only local data the user explicitly chooses to retain.
5. Background deletion follows the documented retention window and is auditable without retaining phrase text in logs.

## Planned repository structure

The implementation phase should introduce these areas only after explicit approval:

- `apps/extension`: Manifest V3 client, popup, options, background worker, and content overlay.
- `apps/dashboard`: authenticated user dashboard and role-protected admin operations view.
- `apps/gateway`: minimal protected translation API for cloud-only features.
- `packages/auth`: identity, session, role, and token-verification boundaries.
- `packages/database`: schema, migrations, user ownership, sync revisions, and deletion operations.
- `packages/contracts`: shared request and response definitions.
- `packages/translation-core`: provider routing, segmentation rules, and text-preservation logic.
- `packages/ui`: small reusable interface components.
- `tests`: unit, integration, browser, accessibility, and security cases.
- `docs`: decisions, privacy disclosures, release instructions, and evaluation evidence.

## Technology direction

- A `pnpm` TypeScript monorepo with independently buildable applications and shared packages.
- Manifest V3 Chrome extension.
- WXT with React for extension-owned interfaces; Next.js is not bundled into the extension.
- TypeScript for extension, dashboard, and gateway.
- Next.js for the server-rendered dashboard and its protected dashboard routes.
- React only for extension-owned interfaces; plain content-script mounting remains small.
- Shadow DOM isolation for the anchored translator; no dependency on webpage classes or styles.
- IndexedDB or Chrome local storage for user-controlled local data.
- A small, independently deployable TypeScript gateway; it is not a public Next.js page and is the only application allowed to hold translation-provider credentials.
- A PostgreSQL-compatible database with migrations and encrypted transport/storage.
- Standards-based OAuth or OpenID Connect; authorization code with PKCE for extension connection.
- Provider adapters so translation vendors can change without rewriting the extension.
- A capability table, refreshed from reviewed provider documentation, that prevents unsupported fallback routing.

## Important platform constraint

Chrome's built-in Translator API currently supports many languages but does not list Nepali. LingoBridge therefore needs a cloud provider for English–Nepali and Romanized Nepali features unless Chrome adds that language later. Provider support must be checked again immediately before implementation.

NVIDIA Riva Translate 4B Instruct v2 is now the chosen primary online provider for reviewed supported directions. Google Cloud Translation remains an optional backup and the only configured cloud path that can cover English-Nepali when Google credentials are available. NVIDIA lists 37 languages but not Nepali, so it cannot translate English-Nepali. See `docs/11-language-coverage.md` for the capability policy.

Automatic selection detection cannot rely on `activeTab` alone because that permission begins only after an explicit extension gesture. LingoBridge therefore declares optional HTTP/HTTPS host access and requests it during Instant Selection onboarding. Users may grant the current site or all sites; the popup, context menu, and shortcut remain available without persistent access.
