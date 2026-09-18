import { describe, expect, it } from "vitest";
import {
  looksLikeRomanizedNepali,
  normalizeRomanizedNepali,
} from "../../apps/extension/lib/romanized-nepali";

describe("Romanized Nepali normalization", () => {
  it("converts common daily sentences with spelling variants", () => {
    expect(normalizeRomanizedNepali("ma ghar jadai chu")?.text).toBe("म घर जाँदै छु");
    expect(normalizeRomanizedNepali("ma ghar janxu ani kaam garxu")?.text).toBe(
      "म घर जान्छु अनि काम गर्छु",
    );
    expect(normalizeRomanizedNepali("timro naam k ho")?.text).toBe("तिम्रो नाम के हो");
    expect(normalizeRomanizedNepali("Ma bhaat khadaichu")?.text).toBe("म भात खाँदै छु");
  });

  it("keeps unknown names and technical words visible instead of guessing them", () => {
    expect(normalizeRomanizedNepali("mero naam Kushal ho")?.text).toBe("मेरो नाम Kushal हो");
  });

  it("does not treat ordinary English as Romanized Nepali", () => {
    expect(normalizeRomanizedNepali("I want to translate this sentence")).toBeNull();
    expect(normalizeRomanizedNepali("hello world")).toBeNull();
  });

  it("converts the new everyday words", () => {
    expect(normalizeRomanizedNepali("timi mero vai ho")?.text).toBe("तिमी मेरो भाइ हो");
    expect(normalizeRomanizedNepali("malai bhok lagyo")?.text).toBe("मलाई भोक लाग्यो");
  });

  it("recognises chat-style Nepali mixed with English words", () => {
    const text = "hello bro k xa timro halkhabar";
    expect(looksLikeRomanizedNepali(text)?.text).toBe("hello bro के छ तिम्रो हालखबर");
    expect(looksLikeRomanizedNepali("hello my friend how are you")).toBeNull();
  });
});
