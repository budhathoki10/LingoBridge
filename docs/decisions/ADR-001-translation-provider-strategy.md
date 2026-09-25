# ADR-001: Translation provider strategy

Status: **Accepted; amended on 16 September 2026 for MyMemory primary and NVIDIA fallback; translation order amended again by [ADR-009](ADR-009-nemotron-first-translation.md) on 25 September 2026; credentialed deployment and quality validation pending**
Decision date: **6 September 2026**

## Context

LingoBridge needs low-friction multilingual translation, strong privacy, and particularly careful English–Nepali quality. Chrome provides an on-device Translator API for supported desktop language pairs, but its catalogue is smaller than the chosen cloud provider and does not currently list Nepali. Context styles and Romanized input may also require more flexible models.

## Decision

Use a user-controlled local mode and a MyMemory-first online architecture:

- Prefer Chrome's on-device Translator API when the user selects On-device mode and the language pair is supported.
- Send Online mode only to a LingoBridge-controlled `POST /v1/translate` gateway.
- Expose every active supported standard translation language and direction through a normalized LingoBridge capability catalogue.
- Use MyMemory's REST `get` endpoint as the primary online translation service.
- Ship a reviewed MyMemory compatibility catalogue because MyMemory accepts ISO/RFC 3066 tags but does not expose a machine-readable supported-language endpoint. Represent its all-listed pairing policy with per-language flags rather than a quadratic direction list.
- Send the configured server-side contact email as MyMemory's `de` parameter on every request. Keep the address out of the extension and logs.
- Split provider segments at safe boundaries so each MyMemory `q` value is no more than its documented 500 UTF-8 byte limit.
- If MyMemory fails, reports exhausted quota, or returns an unusable response, use NVIDIA `riva-translate-4b-instruct-v2` for at most one fallback attempt when the direction is reviewed as supported.
- Keep MyMemory-only languages available for primary translation, but block NVIDIA fallback for every unsupported language or variant. Convert reviewed compatible MyMemory tags to NVIDIA model tags only at the NVIDIA adapter boundary.
- Do not use the selected NVIDIA model for Nepali because Nepali is absent from its supported languages; English-Nepali therefore has no fallback when MyMemory is unavailable.
- Put translation vendors behind an internal provider contract.
- Never place provider secrets in the extension.
- Never change an On-device request to Online without the user's informed choice.
- Disclose MyMemory, the configured contact email sent in `de`, and the possible NVIDIA fallback before Online use, and identify the provider that produced each result.

## Endpoint boundaries

- Extension to LingoBridge: `POST /v1/translate` on the configured LingoBridge API origin.
- Extension to LingoBridge capabilities: `GET /v1/capabilities` on the same origin.
- LingoBridge to MyMemory: `GET https://api.mymemory.translated.net/get` with `q`, `langpair`, `de`, and `mt=1`.
- LingoBridge to NVIDIA: the server-configured NIM OpenAI-compatible chat-completions endpoint for `nvidia/riva-translate-4b-instruct-v2`.

The extension knows only the LingoBridge endpoint. The MyMemory contact email and NVIDIA API key remain in server-side configuration.

## Authentication, limits, and retention boundary

- The gateway may retrieve Google's supported languages for capability metadata when configured; Google is not part of the translation route.
- Version 1 accepts at most 5,000 Unicode code points and 20 KiB of UTF-8 source text per translation request. The gateway segments MyMemory calls to its 500-byte per-`q` limit.
- MyMemory's quota and NVIDIA API limits provide outer ceilings; LingoBridge adds its own per-installation and network abuse controls before provider calls.
- LingoBridge does not persist unsaved translation requests or results. MyMemory and NVIDIA processing and retention terms must be re-verified and disclosed before release.

## Validation criteria

- English–Nepali meaning and fluency scores on LingoBridge's reviewed dataset.
- Contract smoke tests for MyMemory success, quota, malformed response, and every advertised NVIDIA fallback direction.
- Romanized Nepali performance.
- Response time and availability.
- Clear data-retention and model-training terms.
- Regional availability and cost.
- Structured output reliability.
- Ability to disable provider-side content retention when offered.
- Correct suppression of NVIDIA for unsupported pairs, including Nepali.

## Rejected approaches

### Calling MyMemory directly from the extension

It would expose the contact email, bypass gateway controls, and make fallback behavior inconsistent.

### A provider key bundled in the extension

Extension packages can be inspected, so the key would be exposed and abused.

### Cloud-only translation for every language

It sends more text off-device than necessary and adds avoidable cost.

### On-device-only translation

It does not currently satisfy the main English–Nepali use case.

## Consequences

The product needs a small backend, two active translation adapters, a versioned capability catalogue, searchable language pickers, and a clear consent experience. NVIDIA provides resilience only for exact reviewed pair tags, so languages including Nepali have a single cloud-provider dependency. Provider quality, quota, retention terms, capability drift, and fallback behaviour remain release gates even though the routing decision is accepted.
