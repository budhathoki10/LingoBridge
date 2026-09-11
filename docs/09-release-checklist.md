# Chrome Web Store release checklist

## Product

- Version 1 matches the approved requirements.
- The extension has one clear purpose: user-triggered text translation.
- Onboarding explains selection, pasted text, On-device, and Online modes.
- Onboarding explains that Instant Selection needs current-site or all-site access and that automatic Online translation sends the selected text after consent.
- Unsupported and offline states are understandable.
- The language picker matches the reviewed capability catalogue and does not advertise unsupported enhanced features.
- Translation and local saving still work without an account; sign-in is required only for the dashboard and synchronized data.
- The dashboard exposes only deliberate saved phrases, approved preferences, connected sessions, export, and deletion—not automatic translation history.

## Package

- Manifest V3 is used.
- The production package contains only required files.
- No source maps expose secrets or private endpoints.
- No remotely hosted executable code exists.
- Icons and screenshots match the actual extension.
- The exact archive has been loaded and tested in a clean profile.

## Permissions

- Every permission has a feature-level explanation.
- No permission is broader than its feature requires.
- Optional site access is requested in context.
- Revoking site access or disabling Instant Selection stops automatic selection handling.
- Incognito behaviour has been reviewed.

## Privacy

- A public privacy policy identifies all processed data and providers.
- The policy names NVIDIA as primary for supported directions and Google as a possible backup.
- Store disclosures match actual network behaviour.
- First online use requests informed consent.
- Sensitive-text warnings prevent silent automatic transmission.
- On-device results are labelled accurately.
- Delete and export controls work.
- Support and deletion contact details are current.
- The dashboard states which records are local, synchronized, exported, or deleted.
- Account deletion revokes all server sessions and removes synchronized records; the user is separately told how to remove local extension data.
- Administrator metrics have been inspected and contain no phrase text, translation text, notes, or identifiers that expose content.

## Security

- The security review in `docs/05-security-and-privacy.md` is complete.
- Provider keys exist only in deployment secrets.
- Gateway validation, limits, timeouts, and safe logging are verified.
- NVIDIA is pair-allowlisted and impossible for Nepali with the selected model; Google backup is limited to one attempt.
- Dependencies and the final archive have been reviewed.
- OAuth/OIDC redirect URLs, PKCE, state, nonce, token rotation, expiry, and revocation are verified in production configuration.
- Dashboard cookies, CSRF controls, CSP, origin rules, authorization checks, and rate limits are verified.
- Cross-user and cross-role authorization tests pass for phrases, preferences, sessions, export, deletion, and administrator APIs.
- Database backups, restoration, migrations, deletion jobs, and least-privilege credentials have an approved operational procedure.

## Dashboard deployment

- Production domain, TLS, OAuth/OIDC callback URLs, trusted origins, and environment secrets match the release configuration.
- Protected pages and APIs reject anonymous requests without leaking synchronized data.
- Empty, loading, offline, expired-session, sync-conflict, and deletion states are understandable on desktop and mobile widths.
- Extension-to-dashboard connection works from the exact store package in a clean Chrome profile.
- Export files are complete, safely encoded, and scoped to the authenticated user.
- Monitoring reports aggregate availability, latency, error rate, provider health, and sync failures without recording user content.

## Quality

- Required automated checks pass.
- English and Nepali review targets pass.
- Automated request-contract smoke tests pass for every advertised NVIDIA direction and every enabled Google backup route.
- Keyboard and zoom checks pass.
- Chrome stable is tested on Windows.
- Installation, update, disable, re-enable, and uninstall flows are tested.
- Dashboard accessibility, responsive layout, account flows, sync retries, session revocation, and deletion are tested.

## Release record

- Record the commit, package checksum, store version, dashboard deployment version, database migration version, test evidence, known limitations, privacy-policy version, and rollback procedure.
