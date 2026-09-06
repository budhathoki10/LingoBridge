# ADR-002: Instant selection and site access

Status: **Accepted for architecture; implementation validation pending**
Decision date: **6 September 2026**

## Context

LingoBridge must detect a completed text selection, identify its language, and show an anchored translator without requiring a second click. A content script must already be present to observe that selection. Chrome's `activeTab` permission is temporary and begins only after an explicit extension gesture, so it cannot provide automatic selection behaviour on its own.

Persistent access to webpages is sensitive. The product must provide the requested instant workflow without silently reading pages or forcing broad access before the user understands the feature.

## Decision

- Declare HTTP and HTTPS origins as optional host permissions.
- During onboarding, explain Instant Selection before requesting access.
- Recommend current-site access first. Let the user deliberately choose all normal websites after seeing the broader-access explanation.
- Keep popup, context-menu, and keyboard-shortcut translation available when persistent access is absent.
- Observe completed pointer and keyboard selections only; do not scan or index complete pages.
- After a short stability interval, accept one eligible active range and suppress duplicate events.
- Open the translator immediately with Detecting and Translating states.
- Use Shadow DOM and an isolated extension world so page CSS and scripts do not control the translator interface.
- Start automatic online translation only after separate Online auto-translation consent.
- Pause automatic transmission for password fields, forbidden elements, and sensitive-looking text.
- Allow global disable, per-site disable, and permission revocation.

## Dynamic registration lifecycle

- Do not declare a static all-site content script.
- After a host permission is granted, the service worker registers the selection observer with `chrome.scripting.registerContentScripts` for only the approved origin set, in the isolated world at `document_idle`.
- When the approved origins change, update or replace that registration. When access is revoked or Instant Selection is disabled, unregister it.
- Because unregistering does not remove a script already injected into an open page, broadcast a disable message first. The existing observer must detach listeners, clear temporary selection state, and remove any LingoBridge overlay immediately; registration removal prevents it from returning on later navigations.
- Reconcile granted permissions, disabled sites, and registered script identifiers on installation, browser startup, extension update, and permission changes.

## Eligibility rules

An automatic selection must be visible, non-collapsed, non-empty after trimming, inside the configured size limit, and different from the last handled active range. Selections inside extension UI, password fields, hidden elements, or unsupported browser pages are rejected.

## Dismissal rules

The surface closes on Escape, explicit close, a new unrelated selection, loss of the selected range, page navigation, or access revocation. It repositions on scroll, resize, and zoom without starting a new translation.

## Consequences

Users receive the one-step experience they requested, but Chrome must show a site-access permission prompt. Optional runtime permission gives users context and control, although all-site access remains powerful and requires precise store disclosure. The extension needs both a lightweight selection observer and robust overlay-positioning tests.

## Rejected alternatives

### `activeTab` only

It protects privacy well but requires a toolbar click, shortcut, or context-menu action before page access, so it cannot detect selections automatically.

### Required all-site access at installation

It would make implementation simpler but asks for broad power before the user sees why it is needed.

### Whole-page mutation observation

It is unnecessary for selection translation and would increase performance and privacy risk.

## Primary sources

- [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome permission declaration guidance](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome optional permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome content-script manifest reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
