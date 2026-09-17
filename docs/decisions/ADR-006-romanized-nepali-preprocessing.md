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

## Amendment: model-backed script conversion (17 September 2026)

The dictionary missed everyday chat spellings (`k xa`, `vai`, `halkhabar`), and MyMemory returns Latin-script Nepali unchanged. The product owner approved a model-backed rewrite:

- Detection stays local. Chat-style text mixed with English loan words (for example `hello bro k xa timro halkhabar`) is now recognised when at least two dictionary words match and they make up at least a third of the words.
- In Online mode, the selected text is sent to `POST /v1/transliterate`. NVIDIA Nemotron 3 Ultra rewrites it in Nepali script without translating it, and OpenRouter is asked once if NVIDIA fails or is slow.
- The gateway accepts only `sourceLanguage: "ne"`, up to 1,000 code points, and requires the `transliteration` consent flag. The online consent version moved to `mymemory-primary-nvidia-backup-v2`, so readers who accepted the earlier wording are asked again.
- A rewrite is rejected unless it is mostly Devanagari letters and close to the source length, so a translation or explanation is never passed on as a rewrite.
- The rewritten text goes through the normal MyMemory route, and the panel shows what it was read as. If both models fail, the local dictionary conversion is used as before.

This replaces the "must not add a new provider call" constraint for Online mode only. Simulated mode and the local fallback still make no extra call.
