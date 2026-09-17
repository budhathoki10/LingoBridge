# ADR-008: OpenRouter backup for explanations and an explicit Translate action

Status: **Accepted and implemented locally; packaged-extension checks pending**
Decision date: **17 September 2026**

## Context

Explain and word understanding depend on NVIDIA Nemotron 3 Ultra. Its hosted endpoint repeatedly
returned HTTP 503 or did not answer for minutes, so both features failed for readers even though the
code and credentials were correct.

Separately, the selection translator translated as soon as it opened, using the saved default
language. A reader who wanted Hindi first paid for an unused Nepali request, and every language
switch sent another request.

## Decision

- Give NVIDIA a primary deadline (default 20 seconds). If it fails or misses the deadline, send the
  same prompt once to an OpenRouter model (default `nex-agi/nex-n2.5-pro:free`), reusing the
  OpenAI-compatible chat client.
- Use OpenRouter only when the explanation consent sets `openRouter: true`. The consent version
  changes to `explain-nvidia-openrouter-v2`, so earlier consent is asked for again, and the consent
  text and privacy page name OpenRouter.
- Mark each answer with the provider that produced it (`nvidia` or `openrouter`).
- Open the selection translator in a `ready` state with a Translate button. Only that button, the
  consent "Allow and translate" button, "Translate anyway", and Retry send text. Choosing a language
  records the choice and clears any previous result without sending anything.
- Keep right-click and keyboard shortcuts opening the same ready translator.

## Consequences

- Explanations keep working when NVIDIA is down, at the cost of a slower answer: a fallback answer
  arrives after the primary deadline plus the backup model's latency.
- Free OpenRouter models have shared rate limits and may log requests. Gemma 4 was unusable during
  evaluation because Google's shared free pool was saturated; see `docs/06-ai-and-translation.md`.
- Translating now always takes one extra click after opening the translator.
