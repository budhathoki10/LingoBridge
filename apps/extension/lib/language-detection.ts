/**
 * Local language detection for selected text.
 *
 * NVIDIA Riva takes the language pair as its instruction rather than as a hint, so it cannot
 * detect anything. With the source picker gone, the extension has to work the language out
 * before it can build a request at all. This is a heuristic, not a model: scripts settle most
 * languages outright, and the rest are scored on the function words that carry a sentence.
 *
 * Candidates come back in order rather than one at a time, because a script can serve several
 * languages and because a catalogue may carry only one variant of a regional pair. The caller
 * takes the first candidate its catalogue actually offers.
 */

interface LanguageProfile {
  /** Characters that rarely appear outside this language. */
  marks?: RegExp;
  /** Function words, which dominate ordinary prose regardless of subject. */
  words: readonly string[];
}

const LATIN_PROFILES: Readonly<Record<string, LanguageProfile>> = {
  cs: { marks: /[řůě]/u, words: ["a", "je", "na", "se", "to", "že", "v", "pro", "jsem", "nebo"] },
  da: {
    marks: /[æøå]/u,
    words: ["og", "er", "det", "til", "en", "på", "af", "med", "for", "ikke"],
  },
  de: {
    marks: /[äöüß]/u,
    words: ["und", "der", "die", "das", "ist", "nicht", "mit", "ein", "eine", "auf", "für", "den"],
  },
  en: {
    words: ["the", "and", "is", "of", "to", "in", "that", "for", "with", "you", "are", "this"],
  },
  "es-ES": {
    marks: /[ñ¿¡]/u,
    words: ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "por", "con", "para"],
  },
  et: { marks: /[õäöü]/u, words: ["ja", "on", "ei", "see", "kui", "aga", "ka", "et", "oma"] },
  fi: {
    marks: /[äö]/u,
    words: ["ja", "on", "ei", "se", "että", "kun", "mutta", "myös", "olen", "ovat"],
  },
  fr: {
    marks: /[àâçéèêëîïôùûœ]/u,
    words: ["le", "la", "les", "des", "une", "est", "et", "que", "pour", "dans", "sur", "elle"],
  },
  hr: { marks: /[čćžšđ]/u, words: ["i", "je", "na", "se", "za", "su", "od", "da", "ali", "kao"] },
  hu: {
    marks: /[őű]/u,
    words: ["és", "az", "egy", "nem", "hogy", "van", "meg", "ez", "de", "már"],
  },
  id: {
    words: ["dan", "yang", "di", "ini", "untuk", "dengan", "tidak", "adalah", "dari", "pada"],
  },
  it: {
    marks: /[àèìòù]/u,
    words: ["il", "la", "che", "di", "e", "un", "per", "non", "sono", "con", "della", "nel"],
  },
  lt: { marks: /[ąčęėįšųūž]/u, words: ["ir", "yra", "kad", "su", "bet", "tai", "iš", "arba"] },
  lv: { marks: /[āēīūķļņģ]/u, words: ["un", "ir", "ka", "ar", "bet", "no", "par", "to", "kas"] },
  nl: {
    words: ["de", "het", "een", "en", "van", "is", "dat", "niet", "met", "voor", "op", "zijn"],
  },
  no: {
    marks: /[æøå]/u,
    words: ["og", "er", "det", "til", "en", "på", "av", "med", "ikke", "som", "jeg"],
  },
  pl: {
    marks: /[ąćęłńśźż]/u,
    words: ["i", "nie", "jest", "się", "na", "do", "że", "to", "w", "z", "dla"],
  },
  "pt-BR": {
    marks: /[ãõç]/u,
    words: ["de", "que", "não", "uma", "para", "com", "os", "as", "do", "da", "em", "por"],
  },
  ro: {
    marks: /[ășțîâ]/u,
    words: ["și", "de", "la", "care", "este", "nu", "cu", "un", "pentru", "din", "sau"],
  },
  sk: { marks: /[ľĺŕô]/u, words: ["a", "je", "na", "sa", "to", "že", "pre", "alebo", "ale"] },
  sl: { marks: /[čšž]/u, words: ["in", "je", "na", "se", "za", "so", "da", "ali", "kot", "pa"] },
  sv: {
    marks: /[äöå]/u,
    words: ["och", "är", "det", "att", "en", "som", "för", "med", "inte", "på", "av"],
  },
  tr: {
    marks: /[ığşİ]/u,
    words: ["ve", "bir", "bu", "için", "ile", "de", "da", "olarak", "daha", "çok"],
  },
  vi: {
    marks: /[ăâêôơưđ]/u,
    words: ["và", "của", "là", "có", "không", "được", "một", "cho", "trong", "người"],
  },
};

const CYRILLIC_PROFILES: Readonly<Record<string, LanguageProfile>> = {
  bg: { marks: /[ъщ]/u, words: ["и", "на", "да", "се", "за", "не", "от", "че", "със"] },
  ru: { marks: /[ыэё]/u, words: ["и", "в", "не", "на", "что", "это", "для", "как", "был"] },
  uk: { marks: /[їієґ]/u, words: ["і", "в", "не", "на", "що", "це", "для", "як", "був"] },
};

/** Devanagari carries both, so the words have to separate them. */
const DEVANAGARI_PROFILES: Readonly<Record<string, LanguageProfile>> = {
  hi: { words: ["है", "और", "में", "का", "की", "को", "से", "यह", "हैं", "नहीं"] },
  ne: { words: ["छ", "हो", "र", "मा", "तपाईं", "गर्न", "भएको", "छैन", "लागि", "हुन्छ"] },
};

const SCRIPT_LANGUAGES: readonly (readonly [RegExp, string])[] = [
  [/[؀-ۿ]/u, "ar"],
  [/[Ͱ-Ͽ]/u, "el"],
  [/[฀-๿]/u, "th"],
  [/[぀-ヿ]/u, "ja"],
  [/[가-힯]/u, "ko"],
];

/** Characters simplified Chinese does not use, which separates the two written forms. */
const TRADITIONAL_HAN = /[說東車間國學會這裡與時個們書電話語專價圖來為體發縣]/u;
const HAN = /[一-鿿]/u;
const CYRILLIC = /[Ѐ-ӿ]/u;
const DEVANAGARI = /[ऀ-ॿ]/u;

/**
 * A catalogue may carry only one side of a regional pair, or only the plain code. Offer those in
 * order so the same reading works against a regional catalogue and a plain one.
 */
const REGIONAL_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  "es-ES": ["es-US", "es"],
  "es-US": ["es-ES", "es"],
  "pt-BR": ["pt-PT", "pt"],
  "pt-PT": ["pt-BR", "pt"],
  "zh-CN": ["zh-TW", "zh"],
  "zh-TW": ["zh-CN", "zh"],
};

function withSibling(code: string): string[] {
  return [code, ...(REGIONAL_FALLBACKS[code] ?? [])];
}

function wordScore(text: string, profile: LanguageProfile): number {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length === 0) return 0;
  const vocabulary = new Set(profile.words);
  const hits = words.filter((word) => vocabulary.has(word)).length;
  return (hits / words.length) * 100 + (profile.marks?.test(text) ? 12 : 0);
}

/**
 * Codes ordered by score, best first. Only readings close to the best one survive: neighbouring
 * languages share function words, but a language that matched a single stray word is noise, and
 * letting it through would hand the caller a plausible-looking wrong answer.
 */
function ranked(text: string, profiles: Readonly<Record<string, LanguageProfile>>): string[] {
  const scored = Object.entries(profiles)
    .map(([code, profile]) => ({ code, score: wordScore(text, profile) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  const top = scored[0]?.score ?? 0;
  return scored.filter((entry) => entry.score >= top * 0.5).map((entry) => entry.code);
}

function topScore(text: string, profiles: Readonly<Record<string, LanguageProfile>>): number {
  return Object.values(profiles).reduce(
    (best, profile) => Math.max(best, wordScore(text, profile)),
    0,
  );
}

/**
 * Candidate language codes for the text, best guess first. An empty array means the text is too
 * short or too ambiguous to call, which the caller should report as an assumption rather than a
 * result.
 */
export function detectTextLanguage(text: string): string[] {
  const normalized = text.trim();
  if (!/\p{L}/u.test(normalized)) return [];

  for (const [pattern, code] of SCRIPT_LANGUAGES) {
    if (pattern.test(normalized)) return [code];
  }
  if (DEVANAGARI.test(normalized)) {
    const order = ranked(normalized, DEVANAGARI_PROFILES);
    return [...new Set([...order, "hi", "ne"])];
  }
  if (HAN.test(normalized)) {
    return withSibling(TRADITIONAL_HAN.test(normalized) ? "zh-TW" : "zh-CN");
  }
  if (CYRILLIC.test(normalized)) {
    return [...new Set([...ranked(normalized, CYRILLIC_PROFILES), "ru"])];
  }

  // A sentence normally contains several function words. None at all is a guess, not a reading.
  if (topScore(normalized, LATIN_PROFILES) < 8) return [];
  return ranked(normalized, LATIN_PROFILES).flatMap(withSibling);
}
