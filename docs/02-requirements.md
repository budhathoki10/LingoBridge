# Requirements and scope

## Version 1 requirements

### Selection translation

- Accept text selected on a normal webpage.
- When Instant Selection is enabled for the site, wait for the selection to stabilize, detect its language, start translation, and open an anchored translator automatically.
- Keep right-click and keyboard-shortcut actions as accessible fallbacks.
- Anchor the translator near the selection while keeping it inside the visible viewport.
- Show source and target language selectors, swap, source text, result, loading, Copy, Listen, Save, settings, and close controls.
- Close on Escape, explicit close, a new unrelated selection, page navigation, or loss of the selected range.
- Do not reopen repeatedly for the same unchanged selection.
- Ignore collapsed, whitespace-only, over-limit, hidden, password, and extension-interface selections.
- Preserve paragraphs, punctuation, names, numbers, links, and line breaks where possible.
- Never translate password fields or hidden fields.

### Popup translation

- Accept pasted or typed text.
- Allow explicit source and target language choices.
- Offer automatic source-language detection.
- Remember the preferred target language.
- Support copy, listen, clear, swap languages, and save phrase actions.

### Language coverage

- Expose every language currently returned by the active online capability source.
- Support translation between active-provider source and target languages when the provider supports that direction.
- Retrieve a normalized capability catalogue through the LingoBridge gateway and keep a last-known-good local cache.
- Provide searchable source and target pickers with recent languages, favourites, automatic detection, and language swap.
- Show a language only when its currently selected operation is supported; translation, transliteration, speech, styles, on-device processing, and Google backup are separate capabilities.
- Do not claim that every language supports every enhanced feature.

### Nepali-specific experience

- Translate English to Nepali and Nepali to English.
- Display both BS and AD dates unchanged unless the user explicitly requests date conversion in a future feature.

### Review and reuse

- Allow the user to compare source and result.
- Show the processing mode and actual provider: On-device, NVIDIA, or Google.
- Show an uncertainty message when language detection or translation confidence is low.
- Save phrases only when the user chooses Save.
- Keep saved phrases locally by default.
- Replace text only inside an editable field and only after the user confirms.
- In Online mode, use NVIDIA Riva Translate 4B Instruct v2 first for reviewed supported directions.
- Use Google Cloud Translation only as a backup when Google is configured, the requested direction is supported, and the user has accepted both providers.
- Never present NVIDIA as an English–Nepali backup because the selected NVIDIA model does not support Nepali.

### Web dashboard and account

- Provide an authenticated web dashboard as a required product surface.
- Keep translation usable in the extension without signing in.
- Let a user connect the extension to the same account through an explicit browser authentication flow.
- Synchronize only phrases the user explicitly saves and preferences approved for sync.
- Show an overview, searchable saved phrases, language filters, connected extension sessions, settings, export, and account deletion.
- Let users edit notes, delete one phrase, delete all phrases, revoke an extension session, export their data, and delete their account.
- Keep site permissions, sensitive-text decisions, and device-specific On-device state local to each extension installation.
- Do not store a complete cloud translation history by default.
- Provide a protected admin view containing aggregate request counts, provider health, latency, error codes, fallback rate, and quota information without source or translated text.

## Version 1 exclusions

- Automatic translation of entire websites.
- Translation that runs on every page in the background.
- Camera, screenshot, image, subtitle, or PDF OCR translation.
- Automatic cloud history of every translation.
- Automatic sending of messages or submission of forms.
- A general chatbot.
- Grammar tutoring, flashcards, and language courses.
- Romanized Nepali interpretation, transliteration, ambiguity explanation, and Natural, Literal, Formal, or Simple style modes until they pass the Phase 9 evaluation.
- Mobile Chrome support, because Chrome desktop extension APIs are the initial platform.

## Quality requirements

- Installation does not require all-site access. Onboarding requests optional site access with a clear explanation before Instant Selection is enabled.
- The basic popup works without page access.
- Users can grant Instant Selection on the current site or all normal websites and can revoke it at any time.
- Translation errors preserve the source text and provide a retry.
- The interface works with keyboard navigation and 200% browser zoom.
- No remote executable code is loaded by the extension.
- No secret key is placed in extension files.

## Acceptance scenarios

1. A user selects an English paragraph, invokes LingoBridge, chooses Nepali, and copies a readable translation.
2. A user pastes Nepali text, source detection identifies Nepali, and LingoBridge returns English.
3. A user translates text inside a message box, reviews it, and deliberately replaces only the selected portion.
4. A user chooses On-device mode for a supported pair, and no translation text is sent to the LingoBridge backend.
5. A cloud request fails, and the original text remains intact with a useful retry message.
6. Google fails for an NVIDIA-supported pair, the gateway retries once with NVIDIA, and the result identifies NVIDIA as the provider.
7. Google fails for an English–Nepali request, LingoBridge does not call the unsupported NVIDIA model and instead preserves the source with a retry message.
8. A user searches for any language in the current Google catalogue, selects a valid pair, and completes a standard translation.
9. The network is unavailable when loading capabilities, and LingoBridge uses its last-known-good catalogue while clearly marking stale availability.
10. A user grants Instant Selection, highlights stable visible text, and an anchored translator opens without another click.
11. A user selects password-field or sensitive-looking text, and LingoBridge does not silently send it online.
