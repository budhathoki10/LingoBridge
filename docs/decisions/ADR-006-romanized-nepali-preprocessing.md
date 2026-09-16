# ADR-006: Romanized Nepali preprocessing

Status: **Accepted as a guarded Phase 9 first pass; release-quality evaluation pending**
Decision date: **15 September 2026**

## Context

Users often write Nepali with Latin letters, such as `ma ghar jadai chu`. General translation providers may sometimes infer the meaning directly, but the extension was labelling this text as English and the output quality was inconsistent.

LingoBridge does not currently have a dedicated transliteration model. A broad claim of Romanized Nepali support still requires a reviewed dataset and fluent-speaker scoring.

## Decision

- Add a local Romanized Nepali preprocessing layer before standard translation.
- Detect only high-confidence Latin-script Nepali where common Nepali dictionary entries dominate the sentence.
- Convert known words and common spelling variants into Nepali script before sending the request.
- Preserve unknown names and technical words in Latin script rather than inventing spellings.
- Send the converted text through the existing Nepali translation route and label the panel as Romanized Nepali.
- Leave low-confidence mixed English text on the existing detection path.
- Keep Natural, Literal, Formal, Simple, and ambiguity modes disabled until separate evaluation accepts them.

## Consequences

The app can handle everyday examples such as `ma ghar jadai chu` without depending on a provider guessing the source script. Quality remains bounded by the dictionary and variant list; unknown or uncommon Romanized Nepali may still need future model-backed transliteration or reviewer-approved expansion.

The preprocessor must not scan page text beyond the selected text, must not add a new provider call, and must not weaken the existing Online consent boundary.
