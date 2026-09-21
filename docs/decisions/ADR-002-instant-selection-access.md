# ADR-002: Selection Magic and site access

Status: **Accepted and implementation validated locally; amended on 21 September 2026 for install-time all-site availability**
Decision date: **6 September 2026**

## Context

LingoBridge must detect a completed text selection and show a small magic icon beside it. Clicking that icon is the explicit user action that starts source-language detection and opens an anchored translation in the user's saved preferred target language. A content script must already be present to observe the selection and display the icon. Chrome's `activeTab` permission is temporary and begins only after an explicit extension gesture, so it cannot provide this immediate selection affordance on its own.

Persistent access to webpages is sensitive. The product must provide the requested instant workflow without silently reading or transmitting complete pages. Selection Magic is now a primary installed capability, so it must be available on ordinary websites without repeated per-site setup.

## Decision

- Declare HTTP and HTTPS origins as required host permissions so Selection Magic is available after installation on ordinary websites.
- Disclose the broad site access in the Chrome Web Store listing and onboarding. Chrome shows the corresponding installation warning.
- Keep popup, context-menu, and keyboard-shortcut translation available when persistent access is absent.
- Observe completed pointer and keyboard selections only; do not scan or index complete pages.
- After a short stability interval, accept one eligible active range and suppress duplicate events.
- Show one small magic-icon button beside an eligible stable selection.
- Do not detect, transmit, or translate the selection merely because the icon appears.
- On icon click, open the translator with Detecting and Translating states and load the user's saved preferred target language.
- The translator may show locally pinned target languages for direct switching after activation and a checklist to save several pins together. Pinning a language alone does not read or send selected text, and the panel still has one default target.
- Use Shadow DOM and an isolated extension world so page CSS and scripts do not control the translator interface.
- Start online translation only after the magic-icon click and separate Online processing consent.
- Block password fields and forbidden elements; pause transmission for sensitive-looking text until the user confirms.
- Allow global disable, per-site disable, and Chrome-managed site-access restriction.

## Dynamic registration lifecycle

- Do not declare a static all-site content script.
- On installation, startup, or update, the service worker registers the selection observer for the declared HTTP and HTTPS host permissions in the isolated world at `document_idle`.
- When Chrome-managed access changes, update or replace that registration. When Selection Magic is disabled, unregister it.
- Because unregistering does not remove a script already injected into an open page, broadcast a disable message first. The existing observer must detach listeners, clear temporary selection state, and remove any LingoBridge overlay immediately; registration removal prevents it from returning on later navigations.
- Reconcile granted permissions, disabled sites, and registered script identifiers on installation, browser startup, extension update, and permission changes.

## Eligibility rules

An eligible selection must be visible, non-collapsed, non-empty after trimming, inside the configured size limit, and different from the last handled active range. Selections inside extension UI, password fields, hidden elements, or unsupported browser pages are rejected and show no magic icon.

## Dismissal rules

The magic icon and translator close on Escape, explicit close, a new unrelated selection, loss of the selected range, page navigation, or access revocation. They reposition on scroll, resize, and zoom without starting a new translation.

## Consequences

Users receive a deliberate two-step experience—select, then click the magic icon—without granting access separately on every domain. Chrome shows a stronger installation warning because all-site access is powerful, so the store disclosure must state that the observer reads only a completed selection and sends nothing until the user clicks. The extension retains global and per-site off controls.

## Rejected alternatives

### `activeTab` only

It protects privacy well but requires a toolbar click, shortcut, or context-menu action before page access, so it cannot show the magic icon immediately after selection.

### Optional per-site access

It minimizes install-time permission scope, but repeated permission prompts make the core Selection Magic feature appear broken on every new website.

### Whole-page mutation observation

It is unnecessary for selection translation and would increase performance and privacy risk.

## Primary sources

- [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome permission declaration guidance](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome optional permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome content-script manifest reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
