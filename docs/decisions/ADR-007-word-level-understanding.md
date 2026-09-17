# ADR-007: Explicit word-level understanding

Status: **Accepted and implemented locally; live Nemotron and packaged-extension checks pending**
Decision date: **16 September 2026**

## Context

A full translation can leave one unfamiliar word unclear. Automatically analyzing every word would
add latency, cost, and unwanted text processing.

## Decision

- Make words in the original selected text interactive only after translation succeeds.
- Use Unicode word segmentation so punctuation remains ordinary text.
- Only make a word interactive if it is likely to be worth explaining: for English source text,
  skip a bundled list of common English words (articles, pronouns, prepositions, and other
  high-frequency vocabulary) so buttons target meaningful words instead of glue words; every other
  source language keeps every word interactive, since no equivalent curated list exists for them
  yet (added 17 September 2026).
- Send one chosen word, the selected text, its existing translation, and the language pair through
  the existing gateway and Nemotron 3 Ultra consent boundary.
- Require structured, validated output containing the word translation, simple meaning, part of
  speech, contextual meaning, one example, and optional pronunciation, all written in the language
  the text was translated into (amended 17 September 2026; pronunciation is spelled in that
  language's script), except part of speech, which stays a standard English grammar term because
  translating it produced garbled results (amended again 17 September 2026).
- Cache results only for the current open translator, keyed by word, context, and language pair.
- Save nothing automatically. Save word creates a separate local vocabulary record and, for a
  connected account, a user-owned dashboard vocabulary record.
- Keep Save phrase unchanged and keep vocabulary separate in the dashboard, export, and deletion.
- Defer translated-text word activation until a provider supplies reliable word alignment.

## Consequences

The extension gains one explicit AI request after translation, the gateway gains a typed
word-understanding route, and MongoDB gains a separate vocabulary collection. Offline local saves
remain available; dashboard upload is best-effort in this first implementation and can be retried by
choosing Save word again after reconnecting.
