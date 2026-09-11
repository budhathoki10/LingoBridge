# How LingoBridge works

## First use

1. The user installs LingoBridge.
2. LingoBridge suggests a target from the browser language and asks the user to confirm it.
3. LingoBridge explains two processing choices: On-device and Online.
4. The user can start with pasted text without granting page access.
5. LingoBridge offers Selection Magic and recommends current-site access first. All-site access remains an optional explained choice.
6. Signing in is optional. Translation and local saved phrases work without an account; sign-in is offered only for dashboard access and deliberate cross-device sync.

## Enable On-device translation

1. The user deliberately chooses **Enable On-device** from the popup or settings.
2. LingoBridge checks the requested language pair with Chrome's Translator API from an extension-owned document.
3. If the pair is ready, LingoBridge enables it immediately. If Chrome reports it as downloadable, LingoBridge waits for a fresh **Prepare language pair** click before creating the translator.
4. LingoBridge shows Chrome's download progress when available, but does not invent or promise a download size.
5. A prepared pair can be reused later. An unavailable or failed pair stays disabled and never falls back to Online silently.

## Translate selected webpage text

1. The user highlights a sentence.
2. After the selection remains stable briefly, LingoBridge shows a small magic icon beside it.
3. The user clicks the magic icon; selecting text alone never starts translation or sends it online.
4. Language detection suggests a source language; the user can correct it.
5. The user's saved preferred target language is selected automatically and can be changed or swapped.
6. LingoBridge uses the user's privacy setting. On-device-only requests stay local; consented Online requests go to NVIDIA first for supported directions.
7. The surface shows loading and then the result with Copy, Listen, and Save actions.
8. Escape or Close dismisses it. Selecting different text replaces it rather than stacking another translator.
9. The temporary source text expires when the surface closes or after a short timeout.

If Selection Magic lacks site access, LingoBridge does nothing silently until the user invokes the context menu, shortcut, or popup. It never tricks the user into believing selection access is active.

## Translate writing

1. The user selects text inside an editable field.
2. LingoBridge translates it and shows source and result side by side.
3. The user chooses Copy or Replace selection.
4. Replace changes only the selected range and never sends the message or form.

## Connect the extension to the dashboard

1. The user clicks **Connect dashboard** from the extension or opens the dashboard directly.
2. Chrome opens an interactive OAuth/OIDC sign-in flow initiated by that click.
3. The authorization server returns a short-lived code through the extension's approved redirect URL.
4. The extension exchanges the code with PKCE and receives a revocable, installation-specific session. Long-lived browser session secrets are never exposed to a webpage or content script.
5. The extension shows the connected account and offers **Disconnect**. Translation remains available after disconnection.

## Save and synchronize a phrase

1. The user deliberately chooses **Save** on a translation.
2. LingoBridge stores the phrase locally first so the action succeeds offline.
3. If the extension is connected and phrase sync is enabled, it sends an idempotent upsert containing only that saved phrase and its user-authored note.
4. The dashboard displays the phrase after synchronization. The user can search, edit the note, export it, or delete it.
5. Edits use revisions, while deletions use tombstones, so retries do not restore stale data.

LingoBridge does not turn every translation into cloud history. Unsaved source text, translated text, site permissions, sensitive-text decisions, and temporary selections remain outside dashboard sync.

## Use the dashboard

1. The signed-in user sees an overview of saved phrases, recent deliberate saves, language-pair filters, and connected extension sessions.
2. Preferences that are safe to synchronize can be changed from either surface.
3. Disconnecting a session revokes only that extension installation.
4. Export produces a user-readable copy of synchronized data.
5. Account deletion requires fresh confirmation, revokes all sessions, deletes synchronized records, and clearly explains which local extension records may still remain on the device.

## Evaluated later: Romanized Nepali

This flow remains disabled in version 1 unless the Phase 9 quality gate explicitly approves it:

1. The user enters text such as `tapailai kasto cha?`.
2. LingoBridge marks it as possible Romanized Nepali rather than pretending the detection is certain.
3. The user chooses Nepali script or English.
4. LingoBridge uses context to distinguish transliteration from translation.
5. The result remains editable before copying or replacement.

## Provider routing

- The language picker contains the current Google-supported catalogue and makes unsupported enhancements visible per pair.
- On-device is preferred when Chrome supports the pair and the chosen style needs only direct translation.
- NVIDIA Riva Translate 4B Instruct v2 is the primary online provider for reviewed supported directions.
- Google Cloud Translation is used as backup only when configured, supported, and consented.
- NVIDIA is not used for Nepali because the selected model does not support it.
- A later release may use Online processing for Romanized Nepali and context styles if their quality and privacy gates pass.
- The user can require On-device only; unsupported requests then show a clear limitation.

## Failure behaviour

- Unsupported language pair: suggest an available processing mode.
- Local model missing: show availability and download progress supplied by Chrome; do not claim a download size Chrome does not provide.
- Network unavailable: retain the source and allow retry.
- NVIDIA failure on a Google-supported pair: use Google backup when configured and label the result.
- NVIDIA-unsupported Nepali with no Google backup: retain the source and show retry; do not route to NVIDIA.
- Provider rate limit: show when the user can retry and which provider failed.
- Low confidence: show alternative wording and ask the user to review names, dates, and formal terms.
- Restricted page or missing site access: keep the popup available and explain that Chrome does not allow the automatic overlay there.
- Dashboard sign-in failure: keep translation and local saving available, preserve pending sync records, and allow a deliberate retry.
- Sync conflict: resolve by record revision, preserve deletion tombstones, and never duplicate an idempotent save.
- Revoked session: stop synchronization, keep the local phrase library readable, and ask the user to reconnect.
