# Claude Code instructions

Follow `AGENTS.md` as the repository-wide source of truth.

Phase 0 through Phase 3.1 are complete. Phase 3.2 is next after explicit authorization. Follow the serial gates in `docs/07-build-plan.md`; real provider calls or credentials must wait until the Phase 3.2 security gate passes.

When asked to review the project:

- compare the request with `docs/02-requirements.md`;
- identify the affected components in `docs/03-architecture.md`;
- apply the controls in `docs/05-security-and-privacy.md`;
- preserve the Instant Selection access and consent boundary in `docs/decisions/ADR-002-instant-selection-access.md`;
- preserve the dashboard, optional-account, deliberate-sync, and authorization boundaries in `docs/13-dashboard.md` and `docs/decisions/ADR-003-dashboard-and-sync.md`;
- verify provider implications against `docs/06-ai-and-translation.md` and the ADR;
- keep the sequential delivery order in `docs/07-build-plan.md`;
- state whether a capability is planned, implemented, tested, or released.

Use the role prompts in `agents/` for focused reviews. Architecture and security agents review designs independently. The quality agent converts approved behaviour into acceptance and evaluation evidence. The product agent protects scope and user value.
