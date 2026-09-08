# Dashboard design

Status: **Required product surface; implementation has not started**

## Purpose

The dashboard gives signed-in users a safe place to manage information they deliberately save from the extension. It is not a feed of everything they translate and is not required for basic translation.

## User navigation

### Overview

- Connected-extension status.
- Number of explicitly saved phrases.
- Recently saved phrases.
- Preferred languages and processing preference.
- Clear setup guidance when no extension is connected.

### Saved phrases

- Search source and translated text.
- Filter by source language, target language, and saved date.
- View source, translation, language pair, provider label, optional note, and saved time.
- Edit the optional note.
- Delete one or multiple phrases.
- Export the user's phrases.

### Preferences

- Preferred target language.
- Default translation style when that feature is supported.
- Online or On-device preference.
- Phrase-sync enabled or disabled.

Site access, disabled websites, sensitive-text confirmations, and downloaded local models remain device-specific and cannot be changed from the web dashboard.

### Connected extensions

- Show the user-friendly device label, connection date, last-used time, and current/revoked state.
- Revoke one extension session or all other sessions.
- Never show access or refresh tokens.

### Privacy and data

- Download an account-data export.
- Delete all synchronized phrases.
- Disconnect phrase synchronization.
- Delete the account after re-authentication and explicit confirmation.
- Show current providers, retention promises, and privacy-policy version.

## Admin operations

The role-protected admin view contains operational metadata only:

- Google and NVIDIA availability.
- Request totals by provider and language code.
- Success, timeout, rate-limit, and error categories.
- Median and 95th-percentile latency.
- Google backup attempts and outcomes.
- Quota and estimated-cost warnings.

It must never show selected text, translated text, saved phrases, authentication tokens, provider keys, complete IP addresses, or user browsing activity.

## Dashboard data model

### User

Account identifier, verified sign-in identity, role, creation time, privacy-policy acceptance, and deletion state.

### Extension session

Session identifier, user identifier, hashed rotating credential reference, user-friendly device label, creation time, last-used time, expiry, and revocation state.

### Saved phrase

User identifier, stable phrase identifier, source text, translated text, source and target language codes, provider label, optional note, created and updated times, revision, and deletion state.

### Synced preference

User identifier, preferred target language, approved default style, processing preference, sync setting, revision, and update time.

### Operational aggregate

Time bucket, provider, language codes, outcome category, latency bucket, fallback indicator, and count. It contains no user text.

## API boundaries

- Authentication and session endpoints connect, refresh, revoke, and sign out extension sessions.
- Saved-phrase endpoints list, upsert, delete, bulk-delete, and export only the authenticated user's records.
- Preference endpoints read and update only approved syncable fields.
- Account endpoints export and delete the authenticated user's data.
- Admin endpoints require a server-verified admin role and return aggregate metadata only.

Exact route names are defined with the shared contracts during implementation rather than embedded in the interface.

## Sync rules

- The extension saves locally before attempting sync.
- Every write is idempotent and includes a stable identifier and revision.
- The newest valid revision wins unless a deletion tombstone exists.
- Offline operations queue locally and retry with bounded backoff.
- Deletion propagates to connected clients before tombstones expire.
- Translation results that were never explicitly saved never enter sync.

## Empty and failure states

- No saved phrases: explain how to save from the extension.
- Extension not connected: offer a clear connection guide.
- Offline: keep the last safe view and mark it as stale.
- Session expired: request sign-in without discarding local extension data.
- Sync conflict: preserve both versions until the user chooses when automatic resolution is unsafe.
- Provider outage: show operational status without exposing request content.

## Responsive and accessible behaviour

- Desktop uses a stable sidebar; smaller screens use a drawer.
- Tables become readable stacked records on narrow screens.
- All search, filters, menus, dialogs, export, revocation, and deletion work by keyboard.
- Destructive controls state exactly what will be deleted and whether local extension data remains.
- Language names and translated text preserve script direction and wrapping.

## Success criteria

- A signed-in user saves a phrase in the extension and sees it in the dashboard after synchronization.
- A dashboard deletion disappears from every connected extension after sync.
- Revoking an extension session prevents its next authenticated request.
- Account deletion revokes every session and completes within the documented retention window.
- Admin metrics remain useful while containing no source or translated text.
