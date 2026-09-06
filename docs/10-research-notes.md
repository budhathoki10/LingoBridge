# Research notes and open decisions

Research checked: **6 September 2026**

## Confirmed platform findings

Chrome's built-in Translator API can translate supported language pairs inside the browser. It is currently a desktop capability, downloads required language models on first use, and is not available inside Web Workers. Chrome's published supported-language table does not list Nepali.

Primary source: [Chrome Translator API documentation](https://developer.chrome.com/docs/ai/translator-api)

Chrome's Identity API provides an extension redirect URL and an interactive web-authentication flow that can support non-Google OAuth providers. The final identity design should use an authorization code with PKCE and begin interactive authentication only after a clear user action.

Primary source: [Chrome Identity API documentation](https://developer.chrome.com/docs/extensions/reference/api/identity)

## Architecture inference

Because users need broad multilingual coverage and the initial evaluation includes English–Nepali, an on-device-only design cannot deliver the intended catalogue. The hybrid architecture is therefore justified:

- use Chrome's local API where the requested pair is supported;
- use a LingoBridge-controlled gateway for the complete Google-supported catalogue, Romanized input, and richer context modes;
- tell the user which path will be used before selected text leaves the device.

Google Cloud Translation Advanced is now the chosen primary online provider. NVIDIA Riva Translate 4B Instruct v2 is the chosen backup for its supported pairs. This routing choice is not proof of translation quality; quality, privacy, latency, availability, and cost still require measurement.

Google's documentation states that translations are supported between languages in its Neural Machine Translation list. The exact catalogue can change, so LingoBridge will retrieve and normalize provider capabilities instead of freezing a language count in the extension.

Google's published language table lists Nepali (`ne`). NVIDIA's published Riva Translate 4B Instruct v2 model card lists 37 languages but not Nepali. This means the selected NVIDIA model cannot back up the central English–Nepali route.

Primary sources:

- [Google Cloud Translation language support](https://docs.cloud.google.com/translate/docs/languages)
- [Google Cloud Translation Advanced request documentation](https://docs.cloud.google.com/translate/docs/translate-text)
- [NVIDIA Riva Translate 4B Instruct v2 model card](https://build.nvidia.com/nvidia/riva-translate-4b-instruct-v2/modelcard)

## Validation before implementation

### User validation

Interview people who regularly use several language pairs, including at least five English–Nepali users. Ask them to demonstrate a recent translation task rather than only describing feature preferences. Validate:

- where the copy, switch-tab, paste, and return workflow causes friction;
- whether selection translation is more valuable than pasted-text translation;
- how often Romanized Nepali is involved;
- which mistakes have meaningful consequences;
- whether users accept online processing when it is clearly disclosed.
- whether users want a deliberate saved-phrase library across devices without automatic translation history;
- which dashboard controls—search, notes, export, session revocation, or account deletion—are valuable enough for version 1.

### Provider evaluation

Evaluate Google and every NVIDIA-supported fallback pair against the same reviewed dataset. Do not approve quality from a short demo. Record:

- English–Nepali meaning and fluency scores;
- Romanized Nepali transliteration and translation scores;
- protected-token and formatting failures;
- median and 95th-percentile response time;
- price per realistic monthly user;
- retention, training, and regional-processing terms;
- structured-response and outage behaviour.

### Prototype validation

Use a non-networked fake provider first. Confirm that a new user can select, translate, review, and copy within fifteen seconds, and that the overlay does not disturb common webpages.

## Open decisions

1. Should nearby-sentence context remain opt-in for every request or be remembered per site?
2. Which model will handle Romanized Nepali and style modes if standard Google translation cannot meet their quality targets?
3. Which speech implementation can be described accurately across operating systems?
4. What retention and deployment region can be promised in the privacy policy?
5. Which OAuth/OIDC provider best satisfies extension PKCE support, dashboard sessions, account deletion, cost, and deployment-region requirements?
6. What exact synchronized preference allowlist is useful without revealing browsing behaviour or sensitive decisions?
7. What deletion completion time and backup-expiry promise can operations reliably meet?

## Resolved for implementation

- Version 1 requests are limited to 5,000 Unicode code points and 20 KiB of UTF-8 source text.
- Instant Selection recommends current-site access first; all-site access is a separate optional choice.
- Dynamic content scripts are registered only for granted origins and are both self-disabled and unregistered when access is removed.
- Next.js serves the dashboard, WXT builds the extension, and the translation gateway remains an independently deployable TypeScript service.

ADR-001, ADR-002, and ADR-003 are accepted at the architecture level. The identity provider and operational retention promises remain open. No implementation should begin until the user explicitly authorizes the implementation phase.
