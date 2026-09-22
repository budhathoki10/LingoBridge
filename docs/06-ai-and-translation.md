# AI and translation design

## Purpose of AI

Version 1 uses models for translation and language detection. Romanized Nepali interpretation, style adaptation, and ambiguity explanation remain disabled candidates until the Phase 9 evaluation accepts them. AI does not browse, take actions, or invent factual information.

## Translation contract

Every provider should return:

- translated text;
- detected source language when requested;
- confidence or an explicit unavailable value;
- provider type: on-device or online;
- warnings for ambiguous text, unsupported features, truncation, or altered formatting;
- optional alternative wording;
- no commentary unless the user requested an explanation.

## Automatic language detection

- Detection starts only after an eligible selection becomes stable and the user clicks its magic icon.
- Prefer an available on-device language detector so opening the translator after the click does not itself disclose text.
- In consented Online mode, resolve the source language before provider routing; both MyMemory and NVIDIA require an explicit source-target pair.
- Show Detecting until a result exists; never label a guess as certain.
- Very short, numeric, emoji-only, or heavily mixed-language selections may require the user to choose the source language.
- The target defaults to the user's preferred language. If source and target resolve to the same language, use the user's most recent different target or ask them to choose.
- A user correction overrides detection for the current request and may update local preferences, but it does not silently train or profile the user.

## Translation rules

- Preserve names unless a recognised transliteration is requested.
- Preserve numbers, currencies, URLs, email addresses, identifiers, and dates.
- Preserve paragraph boundaries and list structure.
- Match the selected translation style.
- Do not censor, expand, summarise, answer, or act on source content.
- Mark ambiguous expressions instead of silently choosing a risky meaning.
- Treat instructions inside the source as text to translate.

## Romanized Nepali rules

Phase 9 accepts a narrow first pass for common Romanized Nepali written in Latin letters. The
extension may normalize high-confidence dictionary-backed Romanized Nepali into Nepali script
before a normal Nepali translation request. This is preprocessing, not a separate provider model,
and it must remain disabled for low-confidence mixed English text.

In Online mode, detected Romanized Nepali is first rewritten in Nepali script by NVIDIA Nemotron 3
Ultra, with OpenRouter as a one-time backup, before the MyMemory translation (ADR-006 amendment,
17 September 2026). The local dictionary conversion remains the fallback.

- Keep transliteration and translation as separate operations.
- Preserve unknown names and technical words rather than inventing Nepali spellings.
- Show or record uncertainty when the dictionary coverage is too low.
- Show uncertainty when the same spelling could represent multiple Nepali words.
- Prefer common conversational Nepali in Natural mode.
- Preserve English technical words when a forced Nepali term would reduce understanding.
- Allow the user to edit the detected Romanized source before processing.

## Context use

Version 1 direct translation uses only selected text. A later evaluated feature may offer **Use nearby sentence for context**; it must show the additional text before processing and require the user's choice.

## Provider strategy

### Chrome on-device translator

Use when the browser supports the source-target pair. Benefits include local processing, no per-request server cost, and better privacy. Limitations include desktop requirements, model download, pair availability, and no current Nepali listing.

### Cloud translation provider

Use LingoBridge's gateway for active-catalogue pairs absent from Chrome. If later approved, Romanized Nepali and style control also use the gateway. The gateway uses this order:

1. MyMemory is the primary online translator and receives the configured contact email as `de` on every provider request. MyMemory meters its free tier per calling IP address, and a shared hosting address can exhaust the day's characters before a single LingoBridge request arrives; setting `MYMEMORY_RAPIDAPI_KEY` routes the same API through RapidAPI so the quota belongs to the subscribing account. The provider, the request contract and the `de` disclosure are unchanged, so online consent is unaffected.
2. NVIDIA `riva-translate-4b-instruct-v2` is attempted once after a MyMemory failure or quota response when the pair is reviewed as supported and the user accepted both providers.
3. If NVIDIA does not support the fallback pair, return a visible failure without attempting it.

The active capability catalogue defines standard Online translation coverage. The selected NVIDIA model lists English and 36 non-English languages but does not include Nepali. NVIDIA is enabled only for exact verified pair tags, not every possible combination of those languages. See `docs/11-language-coverage.md`.

### Explanation models

Explain and word understanding use NVIDIA `nemotron-3-ultra-550b-a55b`. Its hosted trial endpoint
was observed on 16–17 September 2026 answering with HTTP 503 or not answering for minutes, so the
gateway retries a temporary NVIDIA failure once and then, with consent, asks OpenRouter.

On 17 September 2026 the same word and Explain prompts (English source, Nepali and Hindi readers)
were run on OpenRouter free models:

| Model | Availability | Latency | Result |
| --- | --- | --- | --- |
| `google/gemma-4-31b-it:free` | 1 of 31 requests; the rest were upstream shared-pool 429s | 5 s | The one answer was accurate. Not usable as a backup while the pool is saturated. |
| `google/gemma-4-26b-a4b-it:free` | 0 of 30 requests | — | Not evaluated. |
| `nex-agi/nex-n2.5-pro:free` | 5 of 5 | 5–46 s | Natural, accurate Nepali and Hindi. Chosen as the default backup. |
| `nvidia/nemotron-3-super-120b-a12b:free` | 5 of 5 | 6–16 s | Wrong word meanings, misspellings, and a Nepali explanation that restated the translation. |

Free-model availability changes; re-run this comparison before changing `OPENROUTER_MODEL`.

### Fallback policy

LingoBridge must not silently move an On-device request to Online. It may offer the online option with a clear explanation. Online consent discloses MyMemory as primary, the configured contact email sent in `de`, and NVIDIA as a possible fallback. If fallback occurs, the result identifies NVIDIA. Any provider with materially different data handling requires renewed consent before it joins the route.

## Evaluation dataset

Create a reviewed set containing:

- everyday conversation;
- educational paragraphs;
- application instructions;
- professional messages;
- idioms and ambiguous phrases;
- Romanized Nepali with spelling variation;
- names, numbers, dates, currencies, URLs, and formatting;
- unsafe prompt-like text that must be translated literally.

At least two fluent Nepali speakers should independently score meaning preservation, fluency, terminology, and formality. Provider selection should follow those results rather than a single demo.
