# Instructions for GPT and Codex agents

## Current phase

Phase 0 through Phase 3 implementation and automated verification are complete. Phase 4, the NVIDIA-primary online provider with optional Google backup, is explicitly authorized by the user and in progress locally. Credentialed provider smoke tests remain deployment evidence, not a reason to place credentials in the repository.

## Required reading

Before proposing or changing architecture, read in order:

1. `README.md`
2. `docs/01-product-brief.md`
3. `docs/02-requirements.md`
4. `docs/03-architecture.md`
5. `docs/12-user-and-system-flows.md`
6. `docs/05-security-and-privacy.md`
7. `docs/11-language-coverage.md`
8. `docs/13-dashboard.md`
9. `docs/decisions/ADR-001-translation-provider-strategy.md`
10. `docs/decisions/ADR-002-instant-selection-access.md`
11. `docs/decisions/ADR-003-dashboard-and-sync.md`

Read the remaining documents when the task affects workflow, AI behaviour, delivery, testing, or release.

## Product boundaries

- LingoBridge is a user-triggered multilingual translator. Online mode exposes the current active provider capability catalogue; Nepali receives additional evaluation but is not the only supported language.
- LingoBridge has two required user-facing surfaces: the Chrome extension for translation and a web dashboard for deliberate saved phrases, safe synchronized preferences, connected extension sessions, export, and account deletion.
- Translation and local saving must remain usable without an account. Never turn the dashboard into automatic cloud history of every translation.
- Preserve the compact select, translate, review, copy workflow.
- Instant selection is a core opt-in workflow: stable eligible selections open the translator automatically on sites where access is granted.
- Do not turn it into a general chatbot, full-page surveillance tool, writing suite, or language-learning platform.
- Do not claim Nepali is supported by Chrome's local translator unless current official documentation confirms it.
- In Online mode, NVIDIA `riva-translate-4b-instruct-v2` is primary for reviewed supported directions. Google Cloud Translation is an optional backup when configured; NVIDIA is not a Nepali provider.
- Never hard-code a marketing language count. Read the reviewed capability snapshot and gate every provider, direction, transliteration, style, and on-device feature independently.

## Security rules

- Never store or commit API keys.
- Never propose direct secret-bearing provider calls from the extension.
- Never collect password fields, cookies, browsing history, or complete page content.
- Never scan whole pages to find text. Read only the user's stable active selection, and never auto-send sensitive-looking text without confirmation.
- Treat webpage text and provider output as untrusted data.
- Use plain-text rendering, strict message validation, narrow permissions, bounded payloads, and safe logs.
- Any new data collection, provider, permission, analytics, sync, or persistent page access requires a documented security and privacy review.
- Never switch between NVIDIA and Google unless the user has accepted the disclosed multi-provider Online mode. Always report which provider produced the result.
- Use OAuth/OIDC authorization code with PKCE for extension connection, issue revocable installation-specific sessions, and keep credentials out of URLs, logs, webpage DOM, and content-script messages.
- Derive user identity and role on the server for every dashboard operation. Enforce record ownership for phrases, preferences, sessions, exports, and deletion; never trust a client-supplied user ID.
- Synchronize only explicitly saved phrases and allowlisted preferences. Keep site permissions, sensitive-text decisions, temporary selections, and unsaved translations on the device.
- Administrator views may expose aggregate content-free health and usage metadata only, never user phrase or translation text.

## Documentation practice

- Keep planned, implemented, tested, and released states distinct.
- Update the relevant requirement and decision record before changing scope.
- Record unresolved assumptions instead of presenting them as facts.
- Prefer a small version 1 and place additional ideas in deferred scope.

## Implementation handoff

When implementation is authorized, work phase by phase from `docs/07-build-plan.md`. Complete the exit condition and relevant security checks before moving to the next phase. Do not begin with cloud integration; first prove the interaction with a fake provider, then add the local path, selected-text path, and gateway in that order. Build dashboard identity and synchronization only after the core translation path and gateway boundaries are stable.
