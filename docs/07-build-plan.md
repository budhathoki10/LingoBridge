# Small phase-by-phase build plan

Status: **Phase 0 through Phase 5, Phase 7, and Phase 8 implementation and focused automated verification completed locally. Phase 6 is deferred by decision: Chrome's on-device translator has no Nepali listing. Phase 9 Romanized Nepali preprocessing has a guarded local first pass; style and ambiguity modes have not started. Credentialed provider and Google sign-in smoke tests remain deployment evidence.**

Complete these phases serially after the user explicitly authorizes implementation. Keep each phase as one small reviewable change. Do not start the next phase until the current Done when condition passes.

## 0 — close architecture gaps

Completed. Google NMT, explicit local activation, install-time all-site Selection Magic access, dynamic registration, and version 1 scope are now locked in the architecture and decision records.

| Phase | Build or decide | Done when |
| --- | --- | --- |
| 0.1 | Fix Google Cloud Translation Advanced standard NMT as the initial primary model. | Model, endpoint, authentication, language source, quota, and retention are documented consistently. |
| 0.2 | Design the explicit Enable on-device action required before Chrome creates or downloads a local translator. | First-use and returning-user local flows are approved. |
| 0.3 | Choose the Selection Magic site-access model. | ADR-002 documents required HTTP/HTTPS host access and its disclosure. |
| 0.4 | Specify dynamic content-script registration and removal after permission changes. | No static all-site content script is required at installation. |
| 0.5 | Lock version 1 features and exclusions. | Every included feature maps to a later phase. |

## 1 — project foundation

Completed. The pnpm workspaces install cleanly; formatting, lint, type-checking, contract tests, production builds, generated Manifest V3 inspection, and isolated Chromium load/restart verification pass.

| Phase | Build | Done when |
| --- | --- | --- |
| 1.1 | Create extension, dashboard, gateway, shared-contract, database, and test workspaces. | Clean install, formatting, lint, type-check, and empty tests pass. |
| 1.2 | Add the minimum Manifest V3 shell, action, worker, and icons. | The harmless extension loads and reloads in a clean Chrome profile. |
| 1.3 | Define strict request, result, error, provider, consent, and capability contracts. | Invalid, oversized, and unknown data is rejected. |

## 2 — translator interface with fake data

Completed on 7 September 2026. The production popup now has its idle, loading, success, error, and cancelled states; an abortable deterministic fake provider; stale-response protection; and a fixture-driven searchable language picker with native names, recent languages, favourites, RTL metadata, and separately gated enhancements. The focused unit suite and isolated Chromium interaction, keyboard, 320px, effective 200% zoom, Devanagari, RTL, long-text, and no-network checks pass.

| Phase | Build | Done when |
| --- | --- | --- |
| 2.1 | Build the static popup layout and all visible states. | Keyboard, 200% zoom, 320px width, RTL, Devanagari, and long-text checks pass. |
| 2.2 | Connect a deterministic fake translation provider. | Submit, cancel, retry, swap, clear, and stale-response protection work. |
| 2.3 | Add searchable languages, native names, recent items, and favourites from a capability fixture. | Every fixture language is discoverable and enhanced features are gated correctly. |

## 3 — protected Google translation

Phase 3.1 completed on 7 September 2026. The popup reaches a loopback-only Hono gateway through a contract-validating extension client. Health, version, fake capabilities, and translation routes use shared schemas and an injected deterministic fake adapter.

Phase 3.2 completed on 7 September 2026. The gateway now enforces request and response byte ceilings, exact live extension origins, persistent anonymous installation identifiers, per-installation and per-network rate controls, provider cancellation and deadlines, defensive response headers, fixed safe errors, content-free request logs, and environment-only security configuration. The security suite passes before any real provider is enabled.

Phase 3.3 implementation completed on 7 September 2026. Live mode uses the official Google Cloud Translation v3 client with Application Default Credentials, the global `general/nmt` model, explicit text/plain input, automatic or explicit source language, fixed provider errors, and a non-retrying bounded call. The protected gateway integration, consent persistence/revocation, and server-only package boundary are covered by automated tests and production-package inspection. This machine has no ADC or Google project configuration, so a credentialed provider smoke test remains deployment evidence rather than a completed local test.

Phase 3.4 implementation and automated verification completed on 8 September 2026. Live mode retrieves Google's current standard NMT source and target languages on the gateway, strictly normalizes them into the shared versioned contract, creates a content-derived catalogue version, and persists a validated last-known-good snapshot atomically. The gateway reuses fresh metadata, serves clearly marked stale metadata during bounded provider failures, applies retry backoff, deduplicates concurrent refreshes without allowing one cancelled caller to cancel the shared refresh, and fails safely when neither provider metadata nor cache is valid. The extension loads its validated local cache first, rejects a cache from the wrong gateway mode, refreshes it from the gateway, and drives both language pickers and pair validation from the active catalogue. Fresh, stale, malformed, unavailable, cancellation, cache, production-build, and Chromium fake-gateway interaction checks pass; a credentialed Google catalogue refresh remains deployment evidence.

| Phase | Build | Done when |
| --- | --- | --- |
| 3.1 | Add gateway health, version, capabilities, and translation routes using fake adapters. | Extension and gateway communicate through shared contracts. |
| 3.2 | Add validation, limits, cancellation, rate controls, safe errors, redacted logs, and secret storage. | Security tests pass before real text reaches a provider. |
| 3.3 | Add Google Cloud Translation Advanced standard NMT as primary. | Translation works through the gateway and no credential reaches the extension. |
| 3.4 | Add the live, versioned Google capability catalogue with last-known-good caching. | Fresh, stale, malformed, and unavailable catalogue tests pass. |

## 4 — Online providers

| Phase | Build | Done when |
| --- | --- | --- |
| 4.1 | Add the server-side MyMemory adapter as primary, including `de`, 500-byte segmentation, quota handling, and safe errors. | Success, segmentation, quota, timeout, and malformed-response tests pass. |
| 4.2 | Add `nvidia/riva-translate-4b-instruct-v2` as the one-attempt fallback for reviewed supported directions. | Reviewed fallback tags work and Nepali is rejected before any NVIDIA request. |
| 4.3 | Add actual-provider labels and multi-provider consent checks. | Every result truthfully shows On-device, MyMemory, or NVIDIA. |

## 5 — Selection Magic

Completed on 10 September 2026 and amended on 21 September 2026. HTTP and HTTPS host access is declared at installation so the background worker can dynamically register the isolated observer across ordinary websites without repeated domain prompts. Stable eligible selections show one Shadow DOM magic icon without scanning the page, detecting language, or making a request; clicking it starts source inference, uses the saved preferred target, honours Online consent and sensitive-text confirmation, and displays the actual provider-labelled result. Automated coverage verifies selection eligibility, forbidden and sensitive text, strict messages, language rules, viewport positioning, expiry, registration, cancellation, hostile page CSS, narrow and long-content layouts, no request before click, Escape, replacement by a new selection, and per-site disable in bundled Chromium.

| Phase | Build | Done when |
| --- | --- | --- |
| 5.1 | Declare and explain HTTP/HTTPS host access for Selection Magic. | The store package discloses broad access and the popup still works when Chrome restricts it. |
| 5.2 | Dynamically register the isolated observer across permitted sites. | One stable eligible selection shows one magic icon without page scanning, language detection, or a translation request. |
| 5.3 | Reject empty, hidden, password, oversized, duplicate, and extension-owned selections. | Every forbidden test selection produces no translation request. |
| 5.4 | Build the Shadow DOM magic-icon action, anchored translator, and safe viewport positioning. | Page CSS, scrolling, zoom, narrow screens, and long results do not break the icon or translator. |
| 5.5 | After the icon click, add source detection and saved preferred-target rules. | Clear, short, uncertain, mixed-script, and same-language cases behave correctly. |
| 5.6 | Connect user-triggered translation after the magic-icon click and stored Online consent. | Selection alone sends nothing; one icon click produces one current, labelled result in the user's preferred target language. |
| 5.7 | Add sensitive-text warnings that pause transmission. | Seeded secret, payment, identity, health, and OTP examples make no request before confirmation. |
| 5.8 | Add cancellation and temporary-selection expiry. | Close, Escape, new selection, navigation, revocation, and timeout clear the icon, translator, and temporary state. |

## 6 — on-device mode

| Phase | Build | Done when |
| --- | --- | --- |
| 6.1 | Add the explicit local-model enable, availability, download, progress, and failure flow. | A supported pair is prepared through the required user action. |
| 6.2 | Route already prepared pairs locally in On-device-only mode. | Network inspection confirms selected text never leaves the device. |
| 6.3 | Add unavailable and unprepared pair messaging without silent cloud fallback. | Local-only behaviour matches its privacy promise. |

## 7 — result actions

Phase 7.1 and 7.3 implementation and automated verification completed on 12 September 2026. A
delivered result offers Copy, Listen and, for an editable selection, Replace. Copy prefers the
clipboard API and falls back to a carrier inside the panel's own shadow root, so it never adds a
node to the page. Listen is gated on a voice the browser actually has for the target language,
because the catalogue carries no speech data and would otherwise hide the action everywhere;
speech stops when the panel closes. Replace writes only while the captured offsets still hold the
translated text, refusing with a visible message once the page has rewritten the field, and it
submits nothing: no form submission, no synthesized key press, and only an `input` event. That
last guarantee is pinned by tests that read the content script source, so a regression cannot pass
silently.

Phase 7.2 implementation and automated verification completed on 12 September 2026. The selection
panel offers Save phrase only on a delivered result, and only a deliberate click stores anything:
showing, closing, cancelling, or replacing a result saves nothing. Records keep the phrase, its
direction, the actual provider, and the save time, and deliberately omit the page URL. The store
normalizes malformed records away, collapses duplicate ids, replaces an earlier save of the same
text and direction, and is bounded. The popup lists saved phrases with search, delete-one, a
confirmed delete-all, and readable text export. Unit coverage spans normalization, bounding, search,
replacement, deletion, and export; bundled-Chromium coverage verifies search without mutation,
delete-one removing exactly the intended record, confirmed delete-all, and the empty state.

| Phase | Build | Done when |
| --- | --- | --- |
| 7.1 | Add Copy and capability-gated Listen. | Neither action modifies or submits webpage content. |
| 7.2 | Add explicit local phrase saving, search, delete-one, delete-all, and export. | Closing a result never saves it and deletion removes the intended records. |
| 7.3 | Add reviewed replacement for editable selections. | Only the still-valid selected range changes; Send and Submit never trigger. |

## 8 — dashboard and synchronization

Implemented locally on 14 September 2026. The protected Next.js dashboard uses server-validated
sessions, Google OpenID Connect in production and a development-only identity provider locally.
Extension connection uses Chrome Identity with a one-time code and PKCE; tokens live only in the
extension background worker's IndexedDB. Database migrations cover users, revocable sessions,
explicit phrases, approved preferences, revisions, tombstones, and roles. Local-first sync,
dashboard management, recent-authenticated deletion receipts, and a role-protected aggregate
operations view have focused unit, integration, and bundled-Chromium browser coverage. A daily
maintenance command now purges expired sync metadata and de-identified deleted accounts after the
documented window. On 15 September 2026 storage moved from PostgreSQL to MongoDB (ADR-004)
with the same behaviour and tests. The dashboard's Google client credentials, MongoDB Atlas deployment, scheduled
maintenance, and exact-store-package connection are deployment evidence still to collect; see
`docs/14-dashboard-operations.md`.

| Phase | Build | Done when |
| --- | --- | --- |
| 8.1 | Build the responsive dashboard shell, navigation, empty states, and protected route boundary. | Signed-out users cannot open protected pages and layouts work at desktop and mobile widths. |
| 8.2 | Add the selected OAuth or OpenID Connect provider and secure dashboard sessions. | Sign-in, sign-out, expiry, CSRF, state, nonce, and failed-login tests pass. |
| 8.3 | Add users, extension sessions, phrases, preferences, revisions, tombstones, roles, and migrations. | Cross-user authorization tests prove records are isolated. |
| 8.4 | Connect the extension through Chrome Identity using authorization code with PKCE. | A user-triggered connection creates one revocable extension session without exposing tokens. |
| 8.5 | Add local-first phrase and approved-preference synchronization. | Offline retry, idempotency, conflict, update, and deletion propagation tests pass. |
| 8.6 | Build Overview, Saved phrases, Preferences, Connected extensions, and Privacy pages. | A user can find, edit, export, delete, disconnect, and revoke their own data. |
| 8.7 | Add re-authenticated account deletion and a deletion receipt. | All sessions are revoked and cloud data follows the documented deletion window. |
| 8.8 | Add the role-protected content-free admin operations view. | Admin metrics contain provider health and aggregates but no selected, translated, or saved text. |

## 9 — post-core candidate enhancements

Romanized Nepali preprocessing has a guarded local first pass: common dictionary-backed Latin Nepali is detected, normalized to Nepali script, and then sent through the existing Nepali translation route. It does not claim broad Romanized Nepali support, does not use a new model, and keeps style and ambiguity modes disabled until evaluation.

| Phase | Build or decide | Done when |
| --- | --- | --- |
| 9.1 | Evaluate Romanized input and Natural, Literal, Formal, Simple, and ambiguity modes. | Romanized Nepali has local dictionary-backed tests for common examples; release approval still requires two fluent reviewers scoring the same blinded dataset. Style and ambiguity modes remain unevaluated. |
| 9.2 | Implement only accepted enhancements with separate capability flags. | The first Romanized Nepali pass is gated by confidence and falls back to the existing flow for unsupported or low-confidence text. Unsupported languages remain disabled and prompt-like source text stays inert. |

## 10 — quality and release

| Phase | Build | Done when |
| --- | --- | --- |
| 10.1 | Complete keyboard, screen-reader, focus, zoom, RTL, complex-script, localization, and dashboard responsive work. | No critical accessibility issue remains. |
| 10.2 | Test outages, stale capabilities, suspended workers, revoked access, sync conflicts, rate limits, storage failures, and performance. | Every requirement and threat control links to evidence. |
| 10.3 | Run dependency, secret, permission, CSP, authorization, log, database, and final-package reviews. | No unresolved critical or high-severity issue remains. |
| 10.4 | Prepare the store listing, dashboard deployment, screenshots, support page, privacy policy, checksum, and clean-profile test. | Every release-checklist item has evidence. |
| 10.5 | Release to a small test group and monitor metadata-only failures, latency, sync, fallback, and quotas. | Production matches the reviewed extension, dashboard, API, and privacy disclosures. |

## Deferred

Full-page translation, OCR, PDF translation, automatic cloud translation history, Firefox support, paid plans, and unapproved providers stay outside this plan.
