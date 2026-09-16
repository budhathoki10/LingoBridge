# Requirements and scope

## Version 1 requirements

### Selection translation

- Accept text selected on a normal webpage.
- When Selection Magic is enabled for the site, wait for the selection to stabilize and show one small magic-icon button beside the eligible range.
- Do not detect, transmit, or translate the selected text merely because the icon appeared. Start the translation flow only after the user clicks the icon.
- After the icon click, detect the source language and open an anchored translator using the user's saved preferred target language. Let the user correct either language.
- Send the selected text for translation only when the user clicks Translate. Opening the translator, choosing a target language, or switching favorites never starts a translation, so changing away from the default language does not create an unused request. Consent and "Translate anyway" confirmations are themselves explicit translate actions.
- Keep right-click and keyboard-shortcut actions as accessible fallbacks.
- Anchor the translator near the selection while keeping it inside the visible viewport.
- Show source and target language selectors, swap, source text, result, loading, Copy, Listen, Save, settings, and close controls.
- Close on Escape, explicit close, a new unrelated selection, page navigation, or loss of the selected range.
- Do not recreate the icon or reopen the translator repeatedly for the same unchanged selection.
- Ignore collapsed, whitespace-only, over-limit, hidden, password, and extension-interface selections.
- Preserve paragraphs, punctuation, names, numbers, links, and line breaks where possible.
- Never translate password fields or hidden fields.

### Popup translation

- Accept pasted or typed text.
- Allow explicit source and target language choices.
- Offer automatic source-language detection.
- Remember the preferred target language.
- Let users choose several supported target languages together in a favorites picker, save those pins locally, and switch among them in the translator; one target remains the default. Managing pins does not start translation.
- Support copy, listen, clear, swap languages, and save phrase actions.

### Language coverage

- Expose every language currently returned by the active online capability source.
- Support translation between active-provider source and target languages when the provider supports that direction.
- Retrieve a normalized capability catalogue through the LingoBridge gateway and keep a last-known-good local cache.
- Provide searchable source and target pickers with recent languages, favourites, automatic detection, and language swap.
- Show a language only when its currently selected operation is supported; translation, transliteration, speech, styles, on-device processing, and NVIDIA fallback are separate capabilities.
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
- After a successful translation, let the user explicitly choose a word in the original selected
  text and request a concise contextual definition, translation, part of speech, and example.
- Write every explanation and word-understanding field in the language the text was translated
  into, including the part of speech and the example sentence. The pronunciation describes the
  selected source word itself, respelled by sound with that language's letters, never the
  translation's pronunciation or phonetic symbols. Explain shows only the translated example
  sentence.
- Do not analyze words automatically. Cache repeated word requests only for the current open
  translator and save vocabulary only after a separate Save word action.
- Explain and word understanding use NVIDIA Nemotron 3 Ultra first. When NVIDIA fails or does not
  answer within the configured primary deadline, retry once on the configured OpenRouter model, only
  if the user's explanation consent names OpenRouter. The result names the provider that answered.
- Replace text only inside an editable field and only after the user confirms.
- In Online mode, use MyMemory first and include the configured server-side contact email as its `de` parameter on every provider request.
- If MyMemory fails, reports exhausted quota, or returns an unusable response, attempt NVIDIA Riva Translate 4B Instruct v2 once when the requested direction is reviewed as supported and the user accepted both providers.
- Never send an English–Nepali request to NVIDIA because the selected NVIDIA translation model does not support Nepali.

### Web dashboard and account

- Provide an authenticated web dashboard as a required product surface.
- Keep translation usable in the extension without signing in.
- Let a user connect the extension to the same account through an explicit browser authentication flow.
- Synchronize only phrases the user explicitly saves and preferences approved for sync.
- Show an overview, searchable saved phrases, language filters, connected extension sessions, settings, export, and account deletion.
- Show searchable saved vocabulary with delete and text-export actions, separately from phrases.
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
- Broad Romanized Nepali interpretation, ambiguity explanation, and Natural, Literal, Formal, or Simple style modes until they pass the Phase 9 evaluation. A guarded first-pass Romanized Nepali preprocessor may normalize common dictionary-backed Nepali written in Latin letters before standard translation.
- Mobile Chrome support, because Chrome desktop extension APIs are the initial platform.

## Quality requirements

- Installation does not require all-site access. Onboarding requests optional site access with a clear explanation before Selection Magic is enabled.
- The basic popup works without page access.
- Users can grant Selection Magic on the current site or all normal websites and can revoke it at any time.
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
6. MyMemory fails for an NVIDIA-supported pair, the gateway retries once with NVIDIA, and the result identifies NVIDIA as the provider.
7. MyMemory fails for an English–Nepali request, LingoBridge does not call the unsupported NVIDIA model and instead preserves the source with a retry message.
8. A user searches for any language in the reviewed MyMemory catalogue, selects a valid pair, and completes a standard translation.
9. The network is unavailable when loading capabilities, and LingoBridge uses its last-known-good catalogue while clearly marking stale availability.
10. A user grants Selection Magic, highlights stable visible text, sees one magic icon beside it, clicks the icon, and receives an anchored translation in the saved preferred target language.
11. A user selects password-field or sensitive-looking text, and LingoBridge does not silently send it online.
