# Small phase-by-phase build plan

Status: **Phase 0 and Phase 1 completed on 6 September 2026. Phase 2.1 is next.**

Complete these phases serially after the user explicitly authorizes implementation. Keep each phase as one small reviewable change. Do not start the next phase until the current Done when condition passes.

## 0 — close architecture gaps

Completed. Google NMT, explicit local activation, current-site-first onboarding, dynamic registration, and version 1 scope are now locked in the architecture and decision records.

| Phase | Build or decide | Done when |
| --- | --- | --- |
| 0.1 | Fix Google Cloud Translation Advanced standard NMT as the initial primary model. | Model, endpoint, authentication, language source, quota, and retention are documented consistently. |
| 0.2 | Design the explicit Enable on-device action required before Chrome creates or downloads a local translator. | First-use and returning-user local flows are approved. |
| 0.3 | Choose whether onboarding recommends current-site or all-site access first. | ADR-002 contains the final permission prompt flow. |
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

| Phase | Build | Done when |
| --- | --- | --- |
| 2.1 | Build the static popup layout and all visible states. | Keyboard, 200% zoom, 320px width, RTL, Devanagari, and long-text checks pass. |
| 2.2 | Connect a deterministic fake translation provider. | Submit, cancel, retry, swap, clear, and stale-response protection work. |
| 2.3 | Add searchable languages, native names, recent items, and favourites from a capability fixture. | Every fixture language is discoverable and enhanced features are gated correctly. |

## 3 — protected Google translation

| Phase | Build | Done when |
| --- | --- | --- |
| 3.1 | Add gateway health, version, capabilities, and translation routes using fake adapters. | Extension and gateway communicate through shared contracts. |
| 3.2 | Add validation, limits, cancellation, rate controls, safe errors, redacted logs, and secret storage. | Security tests pass before real text reaches a provider. |
| 3.3 | Add Google Cloud Translation Advanced standard NMT as primary. | Translation works through the gateway and no credential reaches the extension. |
| 3.4 | Add the live, versioned Google capability catalogue with last-known-good caching. | Fresh, stale, malformed, and unavailable catalogue tests pass. |

## 4 — NVIDIA backup

| Phase | Build | Done when |
| --- | --- | --- |
| 4.1 | Add the server-side `nvidia/riva-translate-4b-instruct-v2` adapter without automatic fallback. | Reviewed pair tags work and Nepali is rejected before any NVIDIA request. |
| 4.2 | Add one-attempt Google-to-NVIDIA fallback for qualifying errors and supported pairs. | Success, unsupported pair, timeout, cancellation, and double-failure tests pass. |
| 4.3 | Add actual-provider labels and multi-provider consent checks. | Every result truthfully shows On-device, Google, or NVIDIA. |

## 5 — Instant Selection

| Phase | Build | Done when |
| --- | --- | --- |
| 5.1 | Add explained current-site and all-site permission onboarding. | Popup still works when permission is denied or revoked. |
| 5.2 | Register the isolated observer only on granted sites. | One stable eligible selection produces one internal event without page scanning. |
| 5.3 | Reject empty, hidden, password, oversized, duplicate, and extension-owned selections. | Every forbidden test selection produces no translation request. |
| 5.4 | Build the Shadow DOM translator and safe viewport positioning. | Page CSS, scrolling, zoom, narrow screens, and long results do not break it. |
| 5.5 | Add automatic source detection and preferred-target rules. | Clear, short, uncertain, mixed-script, and same-language cases behave correctly. |
| 5.6 | Connect automatic translation after stored Online consent. | Selecting eligible text once produces one current, labelled result. |
| 5.7 | Add sensitive-text warnings that pause transmission. | Seeded secret, payment, identity, health, and OTP examples make no request before confirmation. |
| 5.8 | Add cancellation and temporary-selection expiry. | Close, Escape, new selection, navigation, revocation, and timeout clear temporary state. |

## 6 — on-device mode

| Phase | Build | Done when |
| --- | --- | --- |
| 6.1 | Add the explicit local-model enable, availability, download, progress, and failure flow. | A supported pair is prepared through the required user action. |
| 6.2 | Route already prepared pairs locally in On-device-only mode. | Network inspection confirms selected text never leaves the device. |
| 6.3 | Add unavailable and unprepared pair messaging without silent cloud fallback. | Local-only behaviour matches its privacy promise. |

## 7 — result actions

| Phase | Build | Done when |
| --- | --- | --- |
| 7.1 | Add Copy and capability-gated Listen. | Neither action modifies or submits webpage content. |
| 7.2 | Add explicit local phrase saving, search, delete-one, delete-all, and export. | Closing a result never saves it and deletion removes the intended records. |
| 7.3 | Add reviewed replacement for editable selections. | Only the still-valid selected range changes; Send and Submit never trigger. |

## 8 — dashboard and synchronization

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

These candidates are disabled for version 1. Accepting one requires explicit scope approval after the evaluation; otherwise Phase 10 proceeds without it.

| Phase | Build or decide | Done when |
| --- | --- | --- |
| 9.1 | Evaluate Romanized input and Natural, Literal, Formal, Simple, and ambiguity modes. | Two fluent reviewers score the same blinded dataset and a model is accepted or the features are deferred. |
| 9.2 | Implement only accepted enhancements with separate capability flags. | Unsupported languages remain disabled and prompt-like source text stays inert. |

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
