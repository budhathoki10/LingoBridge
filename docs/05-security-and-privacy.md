# Security and privacy

## Security objective

LingoBridge processes text that may be personal, private, or controlled by a hostile webpage. Its design must limit what can be read, what can leave the device, and what can be retained.

## Permission policy

- Use `activeTab` and `scripting` for user-triggered access.
- Add `contextMenus` for the selection action.
- Add `storage` for settings and explicitly saved phrases.
- Declare HTTP and HTTPS sites as optional host permissions. Request current-site or all-site access only when the user enables Selection Magic and after explaining what the extension can read.
- Selection Magic must stop immediately when access is revoked or the site is disabled.
- Do not request history, cookies, clipboard-read, downloads, debugger, or webRequest. Do not require all-site access at installation; all-site Selection Magic access is an explained runtime choice.
- Keep incognito access disabled by default.

## Data classification

### Temporary

- Selected source text.
- Translation request identifiers.
- Pending overlay state.
- A hash or opaque identifier used only to suppress duplicate handling of the same active selection.

Temporary data uses session storage or memory and expires within five minutes.

### User-controlled local data

- Preferred languages and style.
- On-device or online preference.
- Online-processing consent.
- Phrases the user explicitly saves.

Saved phrases need visible delete-one, delete-all, and export controls.

### Account and synchronized data

- Verified account identifier and role.
- Revocable extension-session metadata.
- Phrases the user explicitly chooses to synchronize.
- Approved cross-device preferences.
- Revision and deletion state needed for reliable synchronization.

The dashboard must provide export, delete-one, delete-all, session revocation, and account deletion. Site permissions, disabled sites, sensitive-text decisions, and local-model state stay on the device.

### Server-processed data

- Selected source text.
- Source and target language.
- Translation style.
- Minimum request metadata needed for security and rate limiting.

The gateway must not create translation history, analytics events containing text, or error logs containing source or result content.

Online consent must name NVIDIA as the primary processor for supported directions and Google Cloud Translation as a possible backup processor when configured. A fallback is allowed only within that disclosed consent. The result must identify the provider that actually processed the text.

## Threats and controls

### Malicious webpage content

Webpage text is untrusted. Render it with text-only DOM APIs, never HTML interpretation. Keep extension logic in Chrome's isolated world and the visual surface in Shadow DOM. Validate every message shape and reject unexpected senders or actions. Do not query page classes to locate content or trust page-generated selection metadata.

### Excessive page observation

The selection observer listens only for completed user pointer and keyboard selection activity. It reads the current range after a stability delay only to validate the selection and position the magic icon. It does not crawl text nodes, attach a whole-page mutation observer, record selection history, detect language, or transmit selected text before the user clicks the icon.

### Secret exposure

Google and NVIDIA credentials never appear in the extension package, source maps, logs, documentation examples, or browser storage. Only the gateway holds secrets through its deployment secret store.

### Oversized or abusive requests

The extension and gateway enforce character and byte limits. The gateway adds per-IP and anonymous-install rate limits, request timeouts, supported-pair allowlists, and a maximum response size.

The fallback router uses a fixed provider capability table. It must not send Nepali requests to NVIDIA Riva Translate 4B Instruct v2, and it must permit at most one provider fallback per user request.

The public capability endpoint contains language and feature metadata only. It exposes no provider credentials, internal account identifiers, quotas, infrastructure details, or user-specific data. The gateway rejects any translation request whose operation is absent from the active capability catalogue.

### Prompt injection

Cloud AI receives a fixed translation instruction and the selected text in separate structured fields. Page text cannot choose tools, change policies, fetch URLs, or request additional browser content. The model response is treated as data.

### Accidental sensitive translation

Online mode clearly states that selected text will be sent to a provider. Online translation begins only after the user clicks the selection's magic icon and has accepted Online processing. The extension warns when simple local patterns resemble passwords, private keys, payment-card numbers, health or identity numbers, or one-time codes and blocks password-field capture entirely. A warning pauses transmission until the user confirms.

### Translation replacing user writing

LingoBridge shows a review state before replacement. Replacement affects only the selected editable range. LingoBridge never triggers Send, Submit, Enter, or click actions.

### Supply-chain compromise

Pin dependencies with a lockfile, keep the dependency set small, run dependency review, and bundle all executable code. Chrome Web Store packages must contain no remotely hosted executable code.

### Account takeover and token theft

Use authorization code with PKCE for extension connection, short-lived access tokens, rotating revocable extension sessions, secure dashboard cookies, state and nonce validation, and recent re-authentication for account deletion. Never place tokens in URLs after the authorization exchange, logs, analytics, page DOM, or content-script messages.

### Cross-user data access

Every saved-phrase, preference, session, export, and deletion operation derives ownership from the authenticated server session, not a client-provided user identifier. Test horizontal and vertical authorization independently. Admin roles are enforced by the server on every request.

### Synchronization conflicts

Writes use stable identifiers, revisions, idempotency, and deletion tombstones. A stale client cannot recreate a deleted phrase silently. Offline queues are bounded and contain only data the user explicitly saved.

### Dashboard web threats

Use server-side authorization, CSRF protection for cookie-authenticated mutations, strict output encoding, a restrictive dashboard Content Security Policy, secure cookies, origin validation, and rate limits. Saved phrase content is untrusted and always rendered as text.

## Content Security Policy

Extension pages should allow scripts from the extension package only. Network connections should be restricted to the approved gateway. Direct browser-to-provider access is not permitted when it would expose credentials or broaden data sharing.

The dashboard uses its own restrictive policy, permits network access only to approved first-party and authentication origins, and contains no third-party analytics that can observe phrase text.

## Phase 3.1 local gateway review

- The extension adds only `http://127.0.0.1:8787/*` as a host permission so the development popup can reach the LingoBridge gateway. It does not permit direct Google, NVIDIA, arbitrary localhost, or public-web requests.
- The development server binds to `127.0.0.1`, not every network interface, and its CORS response is limited to `chrome-extension://` origins.
- The fake adapter contains deterministic local fixtures and makes no outbound provider request. The version endpoint reports `translationMode: fake`, and the popup labels results as simulated.
- Translation payloads use the strict shared request contract. Invalid requests receive bounded errors that do not reflect source text.
- Phase 3.2 must replace the development-origin assumptions with deployment-specific origin validation, rate controls, timeouts, redacted operational logs, response-size limits, and reviewed secret storage before any real provider is enabled.

## Phase 3.2 gateway security review

- Live mode refuses to start without one or more exact `chrome-extension://` origins. Wildcards and arbitrary web origins are rejected; fake local mode remains explicitly separate.
- Each extension installation creates one random UUID in extension-local storage. Translation requests are limited independently by that identifier and by the gateway-observed network address.
- The gateway rejects unsupported media types, invalid contracts, bodies over 24 KiB, source text over 5,000 Unicode code points or 20 KiB, and provider output over 64 KiB before it crosses the API boundary.
- Provider work receives a bounded deadline and abort signal. User cancellation and server timeout are classified separately and return fixed, retry-safe errors.
- Request logs contain only a gateway-generated request identifier, route, method, status, and duration. They do not contain origin text, translated text, provider errors, installation identifiers, or network addresses.
- Configuration is read from deployment environment variables. Provider credentials are not accepted in extension configuration or committed environment files; Google live mode uses Application Default Credentials supplied by the deployment secret or workload-identity system.
- The Phase 3.2 security tests cover origin rejection, throttling, cancellation, timeout races, oversized input and output, safe errors, redacted logs, and defensive headers. No real provider request is made by these tests.

## Phase 3.3 Google provider review

- The Google Cloud Translation v3 client exists only in the gateway workspace. The production extension package contains neither the Google client nor credential markers and can connect only to its configured LingoBridge gateway origin.
- Live gateway startup requires an exact extension-origin allowlist and a validated Google project identifier. Authentication uses Application Default Credentials; API keys and inline service-account JSON are not configuration options.
- Online text uses Cloud Translation Advanced at `locations/global` with the `general/nmt` model and `text/plain` input. Provider retries are disabled at the client boundary and every call remains inside the gateway deadline.
- The extension requires a current, explicit Google Online consent record before a live translation. The bundled privacy notice identifies the submitted fields and Google processor, and consent can be revoked from the popup.
- Automated tests prove request mapping, automatic detection, explicit source languages, safe error handling, cancellation, consent versioning and revocation, and the protected gateway result. No credentialed request was made on the development machine because neither ADC nor a Google project is configured.

## Phase 3.4 capability catalogue review

- Only the gateway asks Google for supported NMT languages. The extension receives a strict, content-only LingoBridge contract with no project identifier, credential, quota, or provider error detail.
- Catalogue versions are derived from normalized capability content, while `verifiedAt` records refresh time. The compact `all-listed` policy avoids an unnecessarily quadratic list of Google pairs.
- The gateway accepts only complete `google-nmt` catalogues as last-known-good data, writes them atomically outside tracked source, reuses fresh data, and labels fallback data as stale. Malformed provider or disk data cannot become an allowlist.
- Concurrent callers share one bounded provider refresh, but cancellation remains caller-scoped. If no valid provider response or stored snapshot exists, capability and translation routes return a fixed safe unavailable error.
- The extension strictly validates cached and refreshed catalogues, rejects cache data from the wrong gateway mode, and never broadens its gateway host permission or calls Google directly.
- Automated tests cover fresh reuse, stale fallback, malformed source and cache, complete unavailability, atomic persistence, concurrent cancellation, extension caching, pair gating, and stale-result labelling. The production extension package was inspected for credential and Google-client markers.

## Phase 5 Selection Magic security review

- HTTP and HTTPS origins are optional host permissions. The extension has no statically declared webpage content script; the background worker registers the isolated observer only for origins the user has granted and removes or disables it after revocation or a per-site opt-out.
- The observer reads only the active, completed selection after a short stability delay. It does not scan, index, or observe the full page, and displaying the magic icon performs no source detection or network request.
- Empty, whitespace-only, hidden, password-field, oversized, duplicate, and extension-owned selections are rejected before the translation surface opens. Temporary selection state is cleared on close, Escape, a new selection, navigation, permission removal, site disable, or expiry.
- The magic-icon click is the translation activation boundary. Source inference, capability loading, Online-consent checks, and gateway translation begin only after that explicit gesture. Sensitive-looking secrets, card numbers, identity or health numbers, and one-time codes pause before transmission and require a second confirmation.
- The anchored translator uses a closed Shadow DOM, renders webpage text and provider output only through text nodes, validates extension messages, bounds message text, keeps requests abortable, and communicates only with the configured LingoBridge gateway.
- Automated unit and bundled-Chromium tests verify permission registration, forbidden selections, sensitive warnings, no request before click, cancellation, viewport bounds, hostile page CSS isolation, narrow and long-content layouts, Escape, replacement by a new selection, and per-site disable. Production-package inspection confirms there is no static content-script declaration or detected provider credential material.

## Privacy interface requirements

- Display On-device or Online beside every result.
- For Online results, display Google or NVIDIA as the actual processor.
- Link to the privacy policy before the first online translation.
- Explain current-site versus all-site Selection Magic access before Chrome displays the permission prompt.
- Provide a visible Selection Magic toggle and per-site disable action.
- Make online consent revocable.
- Provide local-data deletion from settings.
- Provide synchronized-data export, phrase deletion, session revocation, and account deletion from the dashboard.
- Explain clearly which preferences remain device-local and which data synchronizes.
- Explain that system speech voices may have their own processing behaviour.
- State that LingoBridge does not sell text, build advertising profiles, or train its own model from translations.

## Security review gates

Security review is required before adding a permission, provider, analytics SDK, authentication flow, sync feature, or persistent content script. Any change that sends more than the selected text requires a new privacy decision and user-facing consent.
