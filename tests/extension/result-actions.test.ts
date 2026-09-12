import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canSpeakLanguage,
  pickSpeechVoice,
  rangeStillMatches,
  replaceRange,
} from "../../apps/extension/lib/result-actions";

const contentScript = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../apps/extension/entrypoints/selection.content.ts",
  ),
  "utf8",
);

const voices = [
  { lang: "en-GB", name: "Daniel" },
  { lang: "en-US", name: "Samantha" },
  { lang: "ne-NP", name: "Nepali" },
  { lang: "ar", name: "Arabic" },
];

describe("choosing a voice for a result", () => {
  it("prefers an exact tag over a regional relative", () => {
    expect(pickSpeechVoice(voices, "en-US")?.name).toBe("Samantha");
    expect(pickSpeechVoice(voices, "ar")?.name).toBe("Arabic");
  });

  it("accepts a regional voice for a bare language tag", () => {
    expect(pickSpeechVoice(voices, "en")?.name).toBe("Daniel");
    expect(pickSpeechVoice(voices, "ne")?.name).toBe("Nepali");
  });

  it("matches case-insensitively and tolerates underscores", () => {
    expect(pickSpeechVoice(voices, "EN_us")?.name).toBe("Samantha");
  });

  it("refuses a language with no voice, so Listen stays hidden", () => {
    expect(pickSpeechVoice(voices, "ja")).toBeNull();
    expect(pickSpeechVoice(voices, "  ")).toBeNull();
    expect(pickSpeechVoice([], "en")).toBeNull();
    expect(canSpeakLanguage(voices, "ja")).toBe(false);
    expect(canSpeakLanguage(voices, "ne-NP")).toBe(true);
  });
});

describe("guarding an editable replacement", () => {
  const value = "Please translate this sentence.";

  it("accepts the range that still holds the translated text", () => {
    expect(rangeStillMatches(value, 7, 16, "translate")).toBe(true);
  });

  it("refuses once the field changed under the offsets", () => {
    expect(rangeStillMatches("Please rewrite this sentence.", 7, 16, "translate")).toBe(false);
  });

  it("refuses offsets that no longer fit the field", () => {
    expect(rangeStillMatches(value, 7, 999, "translate")).toBe(false);
    expect(rangeStillMatches(value, -1, 5, "Please")).toBe(false);
    expect(rangeStillMatches(value, 9, 4, "x")).toBe(false);
    expect(rangeStillMatches(value, 1.5, 4, "x")).toBe(false);
  });

  it("refuses an emptied field", () => {
    expect(rangeStillMatches("", 0, 9, "translate")).toBe(false);
  });

  it("replaces only the selected span", () => {
    expect(replaceRange(value, 7, 16, "अनुवाद")).toBe("Please अनुवाद this sentence.");
    expect(replaceRange(value, 0, 0, "Hi. ")).toBe("Hi. Please translate this sentence.");
  });
});

/**
 * Phase 7.3 requires that replacing text never submits the page. A regression here would be
 * silent and would send a user's half-written message, so the guarantee is pinned to the source:
 * the content script must never submit a form or synthesize key presses.
 */
describe("replacement never submits the page", () => {
  it("contains no form submission anywhere in the content script", () => {
    expect(contentScript).not.toMatch(/\.submit\s*\(/u);
    expect(contentScript).not.toMatch(/requestSubmit/u);
    expect(contentScript).not.toMatch(/new\s+SubmitEvent/u);
    expect(contentScript).not.toMatch(/dispatchEvent\(\s*new\s+Event\(\s*["']submit["']/u);
  });

  it("synthesizes no keyboard events, so Enter can never be faked", () => {
    expect(contentScript).not.toMatch(/new\s+KeyboardEvent/u);
    expect(contentScript).not.toMatch(/["'](?:keydown|keypress|keyup)["']\s*,\s*\{/u);
  });

  it("raises only input events when writing into a field", () => {
    const dispatched = [...contentScript.matchAll(/new Event\(\s*["']([a-z]+)["']/gu)].map(
      (match) => match[1],
    );
    expect(dispatched.length).toBeGreaterThan(0);
    expect([...new Set(dispatched)]).toEqual(["input"]);
  });
});
