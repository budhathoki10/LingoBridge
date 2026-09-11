# Testing and evaluation

## Functional coverage

- Text entry, paste, clear, copy, language swap, style selection, save, search, and delete.
- Every advertised Google language direction through automated contract smoke tests.
- Representative multilingual quality cases, English–Nepali, Nepali–English, supported on-device pairs, and unsupported pairs.
- Romanized Nepali transliteration and translation only when a Phase 9 feature gate is under evaluation.
- Empty, whitespace-only, emoji, mixed-script, multiline, and maximum-size inputs.
- Network failure, timeout, provider limit, local-model download, and unavailable model.
- NVIDIA success, NVIDIA-to-Google backup, unsupported NVIDIA pair, double failure, and backup timeout.
- Selection translation on static pages, dynamic pages, nested elements, and editable fields.
- Pointer, keyboard, touchpad, double-click, drag, select-all, rapidly changing, repeated, and collapsed selection behaviour.
- Overlay positioning near every viewport edge, during scroll, resize, zoom, and page navigation.
- Current-site access, all-site access, revoked access, disabled site, restricted Chrome page, and iframe behaviour.
- Capability refresh, stale cached catalogue, removed languages, search, favourites, native names, and language swap.
- Dashboard sign-in, sign-out, extension connection, per-installation revocation, and expired-session recovery.
- Local-only save, offline save, first sync, idempotent retry, note edit, deletion tombstone, conflict, reconnect, export, and account deletion.
- Dashboard overview, phrase search and filters, preferences, connected sessions, empty states, loading states, and responsive layouts.
- Admin access denial for ordinary users and aggregate-only operational metrics for authorized administrators.

## Security coverage

- Source text is rendered as text and cannot execute HTML or script.
- Messages with invalid origin, sender, action, or payload are rejected.
- Password fields are never captured.
- Merely selecting text or displaying the magic icon produces no translation request, language-detection request, or online transmission.
- Sensitive-looking selections pause online transmission after the magic-icon click until confirmed.
- Page CSS cannot restyle the Shadow DOM translator, and translator CSS cannot alter the page.
- Card-like numbers, one-time codes, and secret-like content trigger the intended protection.
- Online requests cannot exceed size or rate limits.
- Nepali requests cannot enter the NVIDIA Riva adapter.
- One user action cannot produce more than one backup attempt.
- Logs and error reports contain no source or translated text.
- Packaged files contain no keys or remotely hosted executable code.
- OAuth/OIDC state, nonce, redirect allowlist, authorization-code lifetime, and PKCE verification reject tampering and replay.
- Extension sessions are installation-specific, revocable, rotated, and absent from URLs, logs, content-script messages, and webpage DOM.
- Every phrase, preference, export, and deletion operation derives the user from the authenticated server session and rejects cross-user identifiers.
- Dashboard forms resist CSRF, rendered phrase content cannot execute, cookies use secure attributes, and the CSP blocks unapproved script and connection origins.
- Server-side role checks protect administrator routes and APIs; changing client-side state cannot grant administrator access.

## Privacy verification

- Record network traffic for an On-device translation and confirm that translation text is absent.
- Record network traffic for Online mode and confirm that only the reviewed request fields are sent.
- Confirm the interface identifies Google or NVIDIA according to the provider that returned the result.
- Revoke online consent and confirm that cloud translation cannot proceed silently.
- Delete saved data and verify that local phrase records are removed.
- Close a selection flow and verify temporary text expires.
- Disable Selection Magic and revoke host access, then confirm no selection listener operates on newly loaded pages.
- Translate without signing in and confirm no account or sync request is required.
- Confirm that unsaved translations, temporary selections, site permissions, and sensitive-text decisions never appear in synchronized records.
- Save one phrase and confirm that only the explicitly saved record and approved preference fields are synchronized.
- Revoke one connected extension and confirm that its next sync fails without affecting other installations.
- Export synchronized data, delete the account, verify server-side records and sessions are removed, and verify the interface distinguishes any remaining local data.
- Confirm administrator metrics contain counts, latency, errors, and provider health but no source text, translated text, notes, or phrase identifiers.

## Accessibility coverage

- Complete every flow with a keyboard.
- Use visible focus and meaningful accessible names.
- Announce loading, download, success, and error states.
- Preserve layout at 200% zoom.
- Respect reduced-motion preferences.
- Verify readable contrast and correct language direction for supported right-to-left output.
- Verify representative Latin, Cyrillic, Arabic, Devanagari, CJK, Thai, and mixed-script results.

## Translation quality

The evaluation set should contain at least 150 examples across the categories in the AI design. Two fluent Nepali reviewers score each result from one to five for:

- meaning preservation;
- naturalness;
- terminology;
- tone;
- formatting and protected-token preservation.

Release targets:

- No altered URLs, email addresses, dates, or numeric identifiers in the protected-token set.
- Average meaning-preservation score of at least 4.0.
- Average naturalness score of at least 3.8 in Natural mode.
- No critical mistranslation in the reviewed application-instruction set.
- If Romanized Nepali is approved for a later release, at least 90% correct operation choice for clearly written evaluation examples.

## Performance targets

- Popup becomes usable within 300 milliseconds on a typical supported laptop.
- Cached on-device translation starts within one second for short text.
- Online short-text translation completes within three seconds at the 95th percentile under normal service conditions.
- Content-script work does not continuously scan or observe pages when the selection feature is inactive.
- Dashboard authenticated pages become usable within two seconds at the 75th percentile under normal service conditions.
- A synchronized save is visible on another connected surface within five seconds at the 95th percentile when both are online.

## Release evidence

Keep test output, permission review, dependency audit, package inspection, translation-review results, dashboard and authorization test results, database migration evidence, and manual Chrome results with the release record. Clearly separate tested behaviour from planned behaviour.

### Phase 5 local evidence — 10 September 2026

- Repository quality gate: formatting, lint, all workspace type-checks, and 103 unit/integration tests pass.
- Bundled Chromium: four journeys pass, covering the click gate and preferred target, hostile CSS and responsive positioning, in-flight cancellation and replacement, password exclusion, sensitive-text confirmation, Escape, per-site disable, and popup translation without webpage access.
- Production builds pass for the contracts, database, dashboard, gateway, and Chrome Manifest V3 extension.
- The generated manifest has optional HTTP/HTTPS host permissions and no static `content_scripts` entry. Package scanning found no provider API key or private-key material.
- Credentialed NVIDIA and Google provider smoke tests remain deployment evidence; Phase 5 browser validation used the deterministic fake gateway and therefore did not transmit selected text to an external provider.
