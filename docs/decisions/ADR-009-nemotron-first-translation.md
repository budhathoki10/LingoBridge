# ADR-009: Nemotron-first translation with free MyMemory before RapidAPI

Status: **Accepted and implemented locally; production latency and quality measurement pending**
Decision date: **25 September 2026**
Amends: ADR-001 (translation order and the one-fallback rule)

## Context

MyMemory translated every Online request, through a RapidAPI subscription limited to 10,000
requests a month. The gateway splits text into 500-byte segments and each segment is a request, so
the allowance ran out quickly. The free public MyMemory endpoint (about 50,000 characters a day with
a contact email) went unused whenever the RapidAPI key was set.

MyMemory's Nepali is inconsistent: a geology sentence came back with दोष ("blame") for "faults" and
the English word "breaks" merely transliterated. Nepali also had no backup, because Riva Translate 4B
does not support it, so an exhausted MyMemory quota stopped Nepali translation entirely.

## Decision

Translate in this order, skipping any step the reader's consent or the language direction rules out:

1. **NVIDIA Nemotron 3 Ultra** (`NVIDIA_EXPLANATION_MODEL`), for every direction, with a strict
   translation-engine prompt, reasoning off, temperature 0, and JSON output. The gateway rejects an
   empty answer, the source sent back, an answer far longer than the source, or one mostly outside
   the target language's script. Nemotron gets its own time limit
   (`LINGOBRIDGE_TRANSLATION_PRIMARY_TIMEOUT_MS`, default 10 seconds, capped at half the overall
   budget) so a slow answer hands over instead of failing the request.
2. **MyMemory, free public endpoint**, with the `de` contact email.
3. **MyMemory through RapidAPI**, only when a subscription key is configured.
4. **NVIDIA Riva Translate 4B**, only for directions in its capability table (never Nepali).

The whole chain shares one deadline, `LINGOBRIDGE_PROVIDER_TIMEOUT_MS`, raised to 30 seconds in
`render.yaml`. This replaces ADR-001's rule of at most one fallback per request.

A step that reports it is limiting the gateway rests, and later requests skip it instead of
walking past it every time:

- Rate-limited (HTTP 429): rest for the provider's `Retry-After`, or 60 seconds.
- MyMemory's daily quota exhausted: rest for the time MyMemory gives, or one hour, then try again.
- Three outages in a row (timeouts, server or network errors): rest two minutes, then try again.
- A failure that concerns one request only (an unusable answer, an unsupported direction) never
  rests a step, and neither does the reader cancelling.

Resting state is in memory, like the rate limiter, so a restart forgets it and each provider is
simply asked again. When every step is resting, the gateway answers with a retryable error without
calling anyone. Each call, skip, and outcome is logged as a content-free `gateway.translation` line.

## Consequences

- Nepali quality should improve, and Nepali keeps working when MyMemory is exhausted.
- The RapidAPI allowance is spent only after the free public quota runs out.
- Every Online translation is now sent to NVIDIA first, not only as a backup. The processors are
  unchanged (NVIDIA and MyMemory were already disclosed), but the order and the share of text NVIDIA
  receives are not. The connection page, privacy pages, preferences, and landing page describe the
  new order. `ONLINE_PROVIDER_CONSENT_VERSION` is deliberately unchanged in this change: bumping it
  would stop the 0.1.2 extension already submitted to the Chrome Web Store from accepting consent.
  Whether existing users must re-consent is an open product decision.
- Translations get slower: Nemotron's latency replaces MyMemory's (about 0.4 seconds), and a miss
  adds Nemotron's time limit before MyMemory answers. This has not yet been measured in production.
- Translation and Explain now share NVIDIA's per-key request limits.
- Results from Nemotron are labelled `nvidia`, the same as Riva, so the reader sees "NVIDIA".
