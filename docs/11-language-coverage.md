# Language coverage

Status: **Architecture approved; provider capabilities must be refreshed before implementation and release**

## Coverage promise

LingoBridge is multilingual. Online mode exposes every source and target language currently supported by Google Cloud Translation instead of limiting the product to English and Nepali.

This promise applies to standard text translation. Enhanced capabilities such as on-device processing, NVIDIA fallback, transliteration, speech, Romanized input, and translation styles have their own smaller support matrices.

## Capability catalogue

The extension reads a normalized catalogue from the LingoBridge gateway through `GET /v1/capabilities`. The response identifies:

- language code and user-facing name;
- supported source and target directions;
- Google availability;
- NVIDIA backup availability for the exact direction;
- Chrome on-device availability when checked locally;
- transliteration, romanization, speech, and style availability;
- catalogue version and last verification time.

The gateway builds its Google catalogue from Cloud Translation's supported-language capability and keeps a reviewed last-known-good snapshot. The extension caches the last valid LingoBridge catalogue so the language picker can still open during a temporary capability-service failure.

## Google primary coverage

Google Cloud Translation is the primary provider for every language and direction it currently reports as supported. The architecture does not hard-code a language count because Google can add or change languages.

Standard translation availability does not automatically mean that transliteration, speech, custom styles, or local processing are available. The interface must disable or explain unsupported enhancements per language pair.

## NVIDIA backup coverage

The selected `nvidia/riva-translate-4b-instruct-v2` model documents these 37 languages:

- English (`en`)
- Czech (`cs`)
- Danish (`da`)
- German (`de`)
- Greek (`el`)
- European Spanish (`es-ES`)
- Latin American Spanish (`es-US`)
- Finnish (`fi`)
- French (`fr`)
- Hungarian (`hu`)
- Italian (`it`)
- Lithuanian (`lt`)
- Latvian (`lv`)
- Dutch (`nl`)
- Norwegian (`no`)
- Polish (`pl`)
- European Portuguese (`pt-PT`)
- Brazilian Portuguese (`pt-BR`)
- Romanian (`ro`)
- Russian (`ru`)
- Slovak (`sk`)
- Swedish (`sv`)
- Simplified Chinese (`zh-CN`)
- Traditional Chinese (`zh-TW`)
- Japanese (`ja`)
- Hindi (`hi`)
- Korean (`ko`)
- Estonian (`et`)
- Slovenian (`sl`)
- Bulgarian (`bg`)
- Ukrainian (`uk`)
- Croatian (`hr`)
- Arabic (`ar`)
- Vietnamese (`vi`)
- Turkish (`tr`)
- Indonesian (`id`)
- Thai (`th`)

NVIDIA fallback is enabled only for exact language-pair tags documented and verified for this model. LingoBridge must not infer that every combination of these languages is supported. Nepali is not in this list.

## User-interface behaviour

- Search works by language name, native name, and code.
- Recent and favourite languages appear before the full catalogue.
- Automatic detection is a source option, never a target option.
- The same source and target combination is rejected.
- When a pair supports standard translation but not an enhancement, LingoBridge keeps translation available and explains which enhancement is unavailable.
- When the capability catalogue changes, removed pairs are disabled without deleting the user's saved phrases.

## Release checks

- Every advertised Google pair receives an automated request-contract smoke test.
- Every enabled NVIDIA fallback tag receives a success, failure, and provider-labelling test.
- A representative set of high-use scripts receives visual and copy/paste testing.
- English–Nepali receives the deeper human quality evaluation defined in the testing document.
- Right-to-left scripts, complex scripts, accents, surrogate pairs, and mixed-language text receive interface tests.

## Primary sources

- [Google Cloud Translation language support](https://docs.cloud.google.com/translate/docs/languages)
- [Google Cloud Translation API reference](https://docs.cloud.google.com/translate/docs/reference/rest)
- [NVIDIA Riva Translate 4B Instruct v2 model card](https://build.nvidia.com/nvidia/riva-translate-4b-instruct-v2/modelcard)
- [NVIDIA Riva Translate 4B Instruct v2 NIM overview](https://catalog.ngc.nvidia.com/orgs/nim/nvidia/models/riva-translate-4b-instruct-v2/-)
