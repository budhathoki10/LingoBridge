# LingoBridge — Context-Aware Text Translator

Status: **Phase 0 through Phase 4 implementation and automated verification are in progress locally. Credentialed provider smoke tests remain deployment evidence.**

LingoBridge is a multilingual product with two user-facing surfaces: a Chrome extension for translation where users browse and a web dashboard for saved phrases, preferences, connected extension sessions, export, and account control. LingoBridge exposes every language currently supported by its primary Google provider. English–Nepali receives deeper evaluation, but it is not the complete product boundary.

The product is deliberately focused. It translates text selected by the user; it does not continuously read browsing history or automatically rewrite complete websites.

In Online mode, LingoBridge sends requests to its own gateway. The gateway uses NVIDIA Riva Translate 4B Instruct v2 as the primary provider for reviewed supported directions and may use Google Cloud Translation as a disclosed backup when Google is configured. The selected provider is never called directly from the extension.

## Why it is useful

- Translate selected webpage text without changing tabs.
- Detect the selected language and open an anchored translator automatically after selection stabilizes.
- Translate pasted text in a compact popup.
- Detect the source language when confidence is sufficient.
- Use evaluated style and Romanized-input enhancements in a later release if they pass quality gates.
- Hear supported output and copy it in one action.
- Save chosen phrases locally for later use.
- Replace selected text inside an editable field only after review.
- Connect an optional account to synchronize explicitly saved phrases and safe preferences with the dashboard.
- Review, search, export, and delete synchronized data from the web dashboard.

## Documentation map

1. [Product brief](docs/01-product-brief.md)
2. [Requirements and scope](docs/02-requirements.md)
3. [System architecture](docs/03-architecture.md)
4. [How LingoBridge works](docs/04-how-it-works.md)
5. [Complete user and system flows](docs/12-user-and-system-flows.md)
6. [Security and privacy](docs/05-security-and-privacy.md)
7. [AI and translation design](docs/06-ai-and-translation.md)
8. [Build plan](docs/07-build-plan.md)
9. [Testing and evaluation](docs/08-testing-and-evaluation.md)
10. [Chrome Web Store release](docs/09-release-checklist.md)
11. [Research notes and open decisions](docs/10-research-notes.md)
12. [Language coverage](docs/11-language-coverage.md)
13. [Dashboard design](docs/13-dashboard.md)
14. [Translation-provider decision](docs/decisions/ADR-001-translation-provider-strategy.md)
15. [Instant-selection access decision](docs/decisions/ADR-002-instant-selection-access.md)
16. [Dashboard and sync decision](docs/decisions/ADR-003-dashboard-and-sync.md)

## Development quick start

Requirements: Node.js 22 or newer and pnpm 10.

```powershell
pnpm install
pnpm check
pnpm build
```

Run one surface with `pnpm dev:dashboard`, `pnpm dev:extension`, or `pnpm dev:gateway`. For the translator, keep `pnpm dev:gateway` running in one terminal and `pnpm dev:extension` in another. The safe default remains the fake gateway on `http://127.0.0.1:8787`; every translation request is contract-validated, bounded, rate-limited by anonymous installation and network, and subject to a provider deadline. The unpacked production extension is generated at `apps/extension/.output/chrome-mv3`.

### Run the NVIDIA-backed gateway locally

NVIDIA live mode uses a gateway-only API key. Load the unpacked extension once, copy its ID from `chrome://extensions`, and start the gateway with exact configuration:

```powershell
$env:LINGOBRIDGE_TRANSLATION_MODE = "live"
$env:LINGOBRIDGE_ALLOWED_EXTENSION_ORIGINS = "chrome-extension://YOUR_EXTENSION_ID"
$env:NVIDIA_API_KEY = "YOUR_NVIDIA_API_KEY"
pnpm dev:gateway
```

Google backup remains optional. After enabling Cloud Translation for your Google Cloud project and establishing ADC outside this repository, add:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "YOUR_GOOGLE_CLOUD_PROJECT_ID"
```

Do not copy a service-account key, ADC file, NVIDIA key, or API key into the extension or repository. Live mode writes the validated last-known-good online capability snapshot to `.data/online-provider-capabilities.json`; `.data` is ignored by Git.

## Agent instructions

- [GPT/Codex repository instructions](AGENTS.md)
- [Claude Code repository instructions](CLAUDE.md)
- [Product agent](agents/product-agent.md)
- [Extension architecture agent](agents/extension-architect-agent.md)
- [Security agent](agents/security-agent.md)
- [Quality agent](agents/quality-agent.md)

Implementation now proceeds serially from `docs/07-build-plan.md`. Provider credentials must never be committed; real provider integration does not begin until its earlier fake-provider and security gates pass.
