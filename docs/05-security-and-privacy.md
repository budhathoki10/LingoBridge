# Security and privacy

## Security objective

LingoBridge processes text that may be personal, private, or controlled by a hostile webpage. Its design must limit what can be read, what can leave the device, and what can be retained.

## Permission policy

- Use `activeTab` and `scripting` for user-triggered access.
- Add `contextMenus` for the selection action.
- Add `storage` for settings and explicitly saved phrases.
- Declare HTTP and HTTPS sites as optional host permissions. Request current-site or all-site access only when the user enables Instant Selection and after explaining what the extension can read.
- Instant Selection must stop immediately when access is revoked or the site is disabled.
- Do not request history, cookies, clipboard-read, downloads, debugger, or webRequest. Do not require all-site access at installation; all-site Instant Selection access is an explained runtime choice.
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

Online consent must name Google Cloud Translation as the primary processor and NVIDIA as a possible backup processor for supported pairs. A fallback is allowed only within that disclosed consent. The result must identify the provider that actually processed the text.

## Threats and controls

### Malicious webpage content

Webpage text is untrusted. Render it with text-only DOM APIs, never HTML interpretation. Keep extension logic in Chrome's isolated world and the visual surface in Shadow DOM. Validate every message shape and reject unexpected senders or actions. Do not query page classes to locate content or trust page-generated selection metadata.

### Excessive page observation

The selection observer listens only for completed user pointer and keyboard selection activity. It reads the current range after a stability delay and does not crawl text nodes, attach a whole-page mutation observer, record selection history, or transmit anything while the selection is changing.

### Secret exposure

Google and NVIDIA credentials never appear in the extension package, source maps, logs, documentation examples, or browser storage. Only the gateway holds secrets through its deployment secret store.

### Oversized or abusive requests

The extension and gateway enforce character and byte limits. The gateway adds per-IP and anonymous-install rate limits, request timeouts, supported-pair allowlists, and a maximum response size.

The fallback router uses a fixed provider capability table. It must not send Nepali requests to NVIDIA Riva Translate 4B Instruct v2, and it must permit at most one provider fallback per user request.

The public capability endpoint contains language and feature metadata only. It exposes no provider credentials, internal account identifiers, quotas, infrastructure details, or user-specific data. The gateway rejects any translation request whose operation is absent from the active capability catalogue.

### Prompt injection

Cloud AI receives a fixed translation instruction and the selected text in separate structured fields. Page text cannot choose tools, change policies, fetch URLs, or request additional browser content. The model response is treated as data.

### Accidental sensitive translation

Online mode clearly states that selected text will be sent to a provider. Automatic online translation begins only after explicit Instant Selection and Online auto-translation consent. The extension warns when simple local patterns resemble passwords, private keys, payment-card numbers, health or identity numbers, or one-time codes and blocks password-field capture entirely. A warning pauses transmission until the user confirms.

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

## Privacy interface requirements

- Display On-device or Online beside every result.
- For Online results, display Google or NVIDIA as the actual processor.
- Link to the privacy policy before the first online translation.
- Explain current-site versus all-site access before Chrome displays the permission prompt.
- Provide a visible Instant Selection toggle and per-site disable action.
- Make online consent revocable.
- Provide local-data deletion from settings.
- Provide synchronized-data export, phrase deletion, session revocation, and account deletion from the dashboard.
- Explain clearly which preferences remain device-local and which data synchronizes.
- Explain that system speech voices may have their own processing behaviour.
- State that LingoBridge does not sell text, build advertising profiles, or train its own model from translations.

## Security review gates

Security review is required before adding a permission, provider, analytics SDK, authentication flow, sync feature, or persistent content script. Any change that sends more than the selected text requires a new privacy decision and user-facing consent.
