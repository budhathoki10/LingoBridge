import { describe, expect, it } from "vitest";
import { detectTextLanguage } from "../../apps/extension/lib/language-detection";

function top(text: string): string | undefined {
  return detectTextLanguage(text)[0];
}

describe("local language detection", () => {
  it("reads the language of ordinary Latin-script prose", () => {
    expect(top("Chaque matin, Sophie prend un café chaud sur son balcon.")).toBe("fr");
    expect(top("The quick brown fox is jumping over the lazy dog in the garden.")).toBe("en");
    expect(top("Der Hund ist nicht in dem Garten und das Wetter ist gut.")).toBe("de");
    expect(top("El perro que está en la casa no quiere salir por la puerta.")).toBe("es-ES");
    expect(top("Hver morgen drikker Sophie en varm kaffe på sin balkon til arbejde.")).toBe("da");
    expect(top("Het weer is niet goed en de hond van de buren is in de tuin.")).toBe("nl");
  });

  it("settles languages that own their script outright", () => {
    expect(top("مرحبا بالعالم")).toBe("ar");
    expect(top("Καλημέρα κόσμε")).toBe("el");
    expect(top("สวัสดีชาวโลก")).toBe("th");
    expect(top("こんにちは世界")).toBe("ja");
    expect(top("안녕하세요 세계")).toBe("ko");
  });

  it("separates Hindi from Nepali, which share Devanagari", () => {
    expect(top("यह एक अच्छा दिन है और मैं घर में हूँ")).toBe("hi");
    expect(top("तपाईंलाई कस्तो छ र आज मौसम राम्रो छ")).toBe("ne");
    expect(detectTextLanguage("नमस्ते")).toEqual(expect.arrayContaining(["hi", "ne"]));
  });

  it("separates the two written forms of Chinese and offers the other as a fallback", () => {
    expect(top("這是一個學習中文的好機會")).toBe("zh-TW");
    expect(top("这是一个好机会")).toBe("zh-CN");
    expect(detectTextLanguage("这是一个好机会")).toEqual(["zh-CN", "zh-TW", "zh"]);
  });

  it("distinguishes Cyrillic languages and defaults to Russian when unsure", () => {
    expect(top("Это был очень хороший день и я не знаю что делать")).toBe("ru");
    expect(top("Це був дуже добрий день і я не знаю що робити")).toBe("uk");
    expect(top("Тест")).toBe("ru");
  });

  it("returns nothing when there is nothing to read", () => {
    expect(detectTextLanguage("12345")).toEqual([]);
    expect(detectTextLanguage("   ")).toEqual([]);
    expect(detectTextLanguage("Zxqv wmbrt plkgh")).toEqual([]);
  });

  it("offers the regional sibling so a one-variant catalogue still matches", () => {
    expect(detectTextLanguage("El perro que está en la casa no quiere salir")).toContain("es-US");
  });
});
