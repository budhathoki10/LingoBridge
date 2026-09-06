# ADR-001: Translation provider strategy

Status: **Accepted for architecture; implementation and quality validation pending**
Decision date: **6 September 2026**

## Context

LingoBridge needs low-friction multilingual translation, strong privacy, and particularly careful English–Nepali quality. Chrome provides an on-device Translator API for supported desktop language pairs, but its catalogue is smaller than the chosen cloud provider and does not currently list Nepali. Context styles and Romanized input may also require more flexible models.

## Decision

Use a user-controlled local mode and a Google-first online architecture:

- Prefer Chrome's on-device Translator API when the user selects On-device mode and the language pair is supported.
- Send Online mode only to a LingoBridge-controlled `POST /v1/translate` gateway.
- Expose every current Google-supported standard translation language and direction through a normalized LingoBridge capability catalogue.
- Use Google Cloud Translation Advanced `translateText` as the primary online provider.
- Use the standard `general/nmt` model at the global location for the initial release.
- After a qualifying Google failure, retry once with NVIDIA `riva-translate-4b-instruct-v2` only when its documented language list supports the pair.
- Do not use the selected NVIDIA model for Nepali because Nepali is absent from its supported languages.
- Put translation vendors behind an internal provider contract.
- Never place provider secrets in the extension.
- Never change an On-device request to Online without the user's informed choice.
- Disclose Google and the possible NVIDIA fallback before Online use, and identify the provider that produced each result.

## Endpoint boundaries

- Extension to LingoBridge: `POST /v1/translate` on the configured LingoBridge API origin.
- Extension to LingoBridge capabilities: `GET /v1/capabilities` on the same origin.
- LingoBridge to Google: Cloud Translation Advanced `POST https://translation.googleapis.com/v3/projects/{PROJECT_ID}/locations/global:translateText`.
- LingoBridge to NVIDIA: the server-configured NIM inference endpoint for `nvidia/riva-translate-4b-instruct-v2`.

The extension knows only the LingoBridge endpoint. Google service-account credentials and the NVIDIA API key remain in the gateway's deployment secret store.

## Authentication, limits, and retention boundary

- The gateway authenticates Cloud Translation Advanced through Application Default Credentials. Production should prefer workload identity over a downloadable long-lived key; Advanced v3 does not accept a simple API key.
- The gateway retrieves Google's supported languages and normalizes them behind `GET /v1/capabilities`; the extension never freezes a marketing language count.
- Version 1 accepts at most 5,000 Unicode code points and 20 KiB of UTF-8 source text per translation request. This follows Google's smaller-request recommendation while leaving room for multilingual byte expansion.
- Google project quotas and billing alerts provide an outer cost ceiling; LingoBridge adds its own per-installation and network abuse controls before provider calls.
- LingoBridge does not persist unsaved translation requests or results. Google's current data-usage statement says submitted text is held briefly in memory to provide the service. NVIDIA processing and retention terms must be re-verified before Phase 4 and disclosed before backup consent is enabled.

## Validation criteria

- English–Nepali meaning and fluency scores on LingoBridge's reviewed dataset.
- Contract smoke tests for every advertised Google direction and every enabled NVIDIA fallback tag.
- Romanized Nepali performance.
- Response time and availability.
- Clear data-retention and model-training terms.
- Regional availability and cost.
- Structured output reliability.
- Ability to disable provider-side content retention when offered.
- Correct suppression of NVIDIA fallback for unsupported pairs, including Nepali.

## Rejected approaches

### A single anonymous public translation endpoint

It creates quota, reliability, privacy, and abuse-control problems and is unsuitable as the production foundation.

### A provider key bundled in the extension

Extension packages can be inspected, so the key would be exposed and abused.

### Cloud-only translation for every language

It sends more text off-device than necessary and adds avoidable cost.

### On-device-only translation

It does not currently satisfy the main English–Nepali use case.

## Consequences

The product needs a small backend, two provider adapters, a versioned capability catalogue, searchable language pickers, and a clear consent experience. Google defines broad standard translation coverage. NVIDIA provides resilience only for exact overlapping pair tags, so some Google languages—including Nepali—still have a single cloud-provider dependency. Provider quality, cost, retention terms, capability drift, and fallback behaviour remain release gates even though the routing decision is accepted.
