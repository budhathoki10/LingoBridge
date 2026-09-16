# ADR-005: Simple explanations with NVIDIA Nemotron 3 Ultra

Status: **Accepted; implemented and verified locally with the fake gateway; live NVIDIA answers not yet checked**
Decision date: **15 September 2026; amended 16 September 2026 to Nemotron 3 Ultra**

## Context

A translation alone is available free in Google Translate and Chrome. To help people understand
and remember what they read, LingoBridge adds an **Explain** action: the meaning in simple words,
whether the phrase sounds formal or casual, a usage note, and one contextual example sentence.

The translation model (NVIDIA Riva Translate 4B Instruct v2) only translates. Explanations need
a general instruction-following model.

## Decision

- Add a gateway route, `POST /v1/explain`, backed by **NVIDIA Nemotron 3 Ultra**
  (`nvidia/nemotron-3-ultra-550b-a55b`) through the same NVIDIA API catalog endpoint and
  `NVIDIA_API_KEY` that translation already uses. The model is configurable with
  `NVIDIA_EXPLANATION_MODEL`.
- **Explain in the translated language.** The meaning, usage note, and example translations are
  written in the language the reader translated into. Translating into Japanese gives a Japanese
  explanation. The prompt names the language in words, for example "Japanese (ja)".
- **Explain, do not re-translate.** The prompt has the model explain the idea in everyday words for
  a beginner, with good and bad examples, and forbids repeating the translation. If the meaning
  still mostly repeats the translation, or the example merely copies the original translation
  pair, the gateway asks once more for simpler words and a contextual example. The gateway removes
  duplicate examples and returns exactly one useful example. This can add one extra model call.
- The model is asked for one JSON object. The gateway removes any reasoning block or code fence,
  then validates the answer against the shared contract before it reaches the extension.
- Hosted Ultra thinking mode is disabled for this bounded JSON task so the output budget is spent
  on the explanation rather than an unreturned reasoning preamble.
- Explaining is a separate, deliberate click on a translation the reader already has, limited to
  1,000 characters: enough for a word, phrase, or paragraph. For a paragraph the meaning is a plain
  summary of the main idea. Longer selections still show Explain, which says why it cannot run.
- Explain has its own consent (`explain-nvidia-nemotron-v1`), asked on the first click, because
  translation consent describes the Riva translation model, not a general language model.
- Only the selected text, its translation, and the two language codes are sent. Nothing is
  stored by the gateway, and explanations are not added to saved phrases.
- Explanations have their own deadline (`LINGOBRIDGE_EXPLANATION_TIMEOUT_MS`, default 90 seconds)
  because a large general model is slower than translation.
- The system prompt tells the model to treat webpage text only as material to explain, never as
  instructions. Fake mode uses a deterministic offline adapter.

## Consequences

- Each Explain click spends NVIDIA API credit and shares the gateway's existing rate limits.
- Before release, check with real requests that the model returns clean JSON, whether it adds a
  reasoning preamble that needs a reasoning-off setting, response time, and explanation quality
  for Nepali, Japanese, and other supported languages.
- The privacy notice names Nemotron 3 Ultra; the store listing and privacy policy must match.
- Operational metrics do not yet count explanation requests.

## Rejected alternatives

### Asking the translation model to explain

Riva Translate is tuned for translation and cannot reliably produce explanations or examples.

### Claude Haiku 4.5

Considered first. Replaced to keep a single AI provider and a single API key.

### Calling the model from the extension

Every installed copy would carry the API key. All provider calls stay on the gateway.
