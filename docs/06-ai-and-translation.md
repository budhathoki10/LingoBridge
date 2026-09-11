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

- Detection starts only after an eligible selection becomes stable.
- Prefer an available on-device language detector so opening the translator does not itself disclose text.
- In consented Online mode, omit the source language only when Google backup handles detection; NVIDIA requires an explicit reviewed source-target tag.
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

These rules apply only if a later feature gate is accepted; they are not version 1 behaviour.

- Keep transliteration and translation as separate operations.
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

Use LingoBridge's gateway for the complete Google-supported catalogue and pairs absent from Chrome. If later approved, Romanized Nepali and style control also use the gateway. The gateway uses this order:

1. NVIDIA `riva-translate-4b-instruct-v2` is the primary online translator for reviewed supported directions.
2. Google Cloud Translation Advanced is a backup when Google is configured, the pair is supported, and the user has accepted both providers.
3. If neither provider supports the pair, return a visible failure without attempting an unsupported provider.

The active capability catalogue defines standard Online translation coverage. The selected NVIDIA model lists English and 36 non-English languages but does not include Nepali. NVIDIA is enabled only for exact verified pair tags, not every possible combination of those languages. See `docs/11-language-coverage.md`.

### Fallback policy

LingoBridge must not silently move an On-device request to Online. It may offer the online option with a clear explanation. Online consent discloses NVIDIA as primary and Google as a possible backup. If backup occurs, the result identifies Google. Any provider with materially different data handling requires renewed consent before it joins the route.

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
