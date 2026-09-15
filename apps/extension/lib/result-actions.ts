/**
 * Helpers behind Copy, Listen and Replace. They are deliberately free of DOM and browser globals
 * so the rules that matter — which voice may speak a result, and whether an editable range is
 * still the one that was translated — can be tested directly.
 */

export interface SpeechVoiceLike {
  lang: string;
  name: string;
}

/** BCP-47 uses hyphens, but POSIX-style tags turn up too, so both spellings compare equal. */
function normalizeTag(languageCode: string): string {
  return languageCode.trim().toLowerCase().replaceAll("_", "-");
}

function primarySubtag(languageCode: string): string {
  return normalizeTag(languageCode).split("-")[0] ?? "";
}

/**
 * The catalogue carries no speech data, so Listen is gated on what the browser can actually do.
 * An exact tag wins; otherwise any voice sharing the primary subtag is accepted, because a result
 * in `en` is still intelligible read by an `en-GB` voice.
 */
export function pickSpeechVoice<Voice extends SpeechVoiceLike>(
  voices: readonly Voice[],
  languageCode: string,
): Voice | null {
  const wanted = normalizeTag(languageCode);
  if (wanted.length === 0) return null;
  const exact = voices.find((voice) => normalizeTag(voice.lang) === wanted);
  if (exact) return exact;

  const subtag = primarySubtag(languageCode);
  if (subtag.length === 0) return null;
  return voices.find((voice) => primarySubtag(voice.lang) === subtag) ?? null;
}

export function canSpeakLanguage(
  voices: readonly SpeechVoiceLike[],
  languageCode: string,
): boolean {
  return pickSpeechVoice(voices, languageCode) !== null;
}

/**
 * Replacement is allowed only while the captured offsets still hold exactly the text that was
 * translated. If the page rewrote the field in the meantime, the offsets now point at something
 * the user never asked to replace.
 */
export function rangeStillMatches(
  currentValue: string,
  start: number,
  end: number,
  expected: string,
): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end < start || end > currentValue.length) return false;
  return currentValue.slice(start, end) === expected;
}

export function replaceRange(
  value: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}
