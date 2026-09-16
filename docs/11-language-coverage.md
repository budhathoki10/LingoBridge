# Language coverage

Status: **Phase 3 live-catalogue implementation and automated verification complete; credentialed refresh and release review pending**

## Coverage promise

LingoBridge is multilingual. Online mode exposes every source and target language currently supported by the active online capability catalogue instead of limiting the product to English and Nepali.

This promise applies to standard text translation. Enhanced capabilities such as NVIDIA fallback, on-device processing, transliteration, speech, Romanized input, and translation styles have their own smaller support matrices.

## Capability catalogue

The extension reads a normalized catalogue from the LingoBridge gateway through `GET /v1/capabilities`. The response identifies:

- language code and user-facing name;
- supported source and target directions, represented by per-language Google flags plus its reviewed all-listed pairing policy and exact rows for restricted providers;
- Google availability;
- NVIDIA availability for the exact direction;
- Chrome on-device availability when checked locally;
- transliteration, romanization, speech, and style availability;
- catalogue version and last verification time.

The gateway ships the reviewed MyMemory catalogue and may enrich exact matching tags with Google capability metadata when configured. It keeps a validated last-known-good snapshot, and the extension caches the last valid LingoBridge catalogue so the language picker can still open during a temporary capability-service failure.

## MyMemory primary coverage

MyMemory is attempted first for every distinct source-target pair in LingoBridge's reviewed MyMemory compatibility catalogue. MyMemory's API accepts ISO or RFC 3066 language tags but does not publish a machine-readable language-catalogue endpoint, so the checked-in catalogue is reviewed from the maintained MyMemory integration list and carries a verification date. Provider rejection remains a safe failure or eligible NVIDIA fallback. Each MyMemory segment is limited to 500 UTF-8 bytes.

The all-listed pairing policy is encoded with per-language `myMemorySource` and `myMemoryTarget` flags instead of expanding the catalogue into tens of thousands of duplicate direction rows. Regional and script variants remain separate picker entries when MyMemory exposes separate tags for them.

## NVIDIA fallback coverage

NVIDIA Riva Translate 4B Instruct v2 is the one-attempt fallback for reviewed supported directions exposed by the active catalogue. Current implementation enables English-pivot directions only, matching the model-card benchmark shape rather than inferring every possible pair. The selected NVIDIA model does not include Nepali.

MyMemory-only languages stay available while MyMemory is healthy. If MyMemory fails for one of those languages, NVIDIA is not called and the gateway returns a retryable provider error. NVIDIA model tags are mapped only from reviewed compatible MyMemory tags; unsupported languages and variants are blocked from fallback.

Google Cloud Translation may supply optional capability metadata when the gateway is configured with a Google project and Application Default Credentials. It is not in the translation route.

Standard translation availability does not automatically mean that transliteration, speech, custom styles, or local processing are available. The interface must disable or explain unsupported enhancements per language pair.

## NVIDIA model coverage

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

NVIDIA is enabled only for exact language-pair tags documented and verified for this model. LingoBridge must not infer that every combination of these languages is supported. Nepali is not in this list.

## User-interface behaviour

- Search works by language name, native name, and code.
- Recent and favourite languages appear before the full catalogue.
- Automatic detection is a source option, never a target option.
- The same source and target combination is rejected.
- When a pair supports standard translation but not an enhancement, LingoBridge keeps translation available and explains which enhancement is unavailable.
- When the capability catalogue changes, removed pairs are disabled without deleting the user's saved phrases.

## Release checks

- Every advertised NVIDIA pair receives an automated request-contract smoke test.
- Every enabled NVIDIA fallback path receives a success, failure, and provider-labelling test.
- A representative set of high-use scripts receives visual and copy/paste testing.
- English–Nepali receives the deeper human quality evaluation defined in the testing document.
- Right-to-left scripts, complex scripts, accents, surrogate pairs, and mixed-language text receive interface tests.

## Primary sources

- [MyMemory API technical specification](https://mymemory.translated.net/doc/spec.php)
- [Deep Translator MyMemory compatibility catalogue](https://github.com/nidhaloff/deep-translator/blob/master/deep_translator/constants.py)
- [Google Cloud Translation language support](https://docs.cloud.google.com/translate/docs/languages)
- [Google Cloud Translation API reference](https://docs.cloud.google.com/translate/docs/reference/rest)
- [NVIDIA Riva Translate 4B Instruct v2 model card](https://build.nvidia.com/nvidia/riva-translate-4b-instruct-v2/modelcard)
- [NVIDIA Riva Translate 4B Instruct v2 NIM overview](https://catalog.ngc.nvidia.com/orgs/nim/nvidia/models/riva-translate-4b-instruct-v2/-)
