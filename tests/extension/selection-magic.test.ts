import { describe, expect, it } from "vitest";
import {
  buildSelectionRegistration,
  computeAnchoredPosition,
  createSelectionMagicRepository,
  detectSensitiveSelection,
  evaluateSelection,
  grantsWebpageAccess,
  limitTranslationText,
  normalizeSelectionMagicSettings,
  originToMatchPattern,
  pageOriginFromUrl,
  parseSelectionMagicMessage,
  selectionFingerprint,
  SELECTION_MAGIC_EXPIRY_MS,
  selectionRegistrationMatches,
} from "../../apps/extension/lib/selection-magic";

describe("Selection Magic settings and permissions", () => {
  it("starts enabled on a fresh installation but preserves an explicit global opt-out", () => {
    expect(normalizeSelectionMagicSettings(undefined)).toEqual({
      disabledOrigins: [],
      enabled: true,
    });
    expect(normalizeSelectionMagicSettings({ disabledOrigins: [], enabled: false })).toEqual({
      disabledOrigins: [],
      enabled: false,
    });
  });

  it("normalizes settings and rejects non-web origins", () => {
    expect(
      normalizeSelectionMagicSettings({
        disabledOrigins: ["https://example.com", "https://example.com", "chrome://settings", 42],
        enabled: true,
      }),
    ).toEqual({ disabledOrigins: ["https://example.com"], enabled: true });
  });

  it("persists normalized settings", async () => {
    const values: Record<string, unknown> = {};
    const repository = createSelectionMagicRepository({
      async get(key) {
        return { [key]: values[key] };
      },
      async set(items) {
        Object.assign(values, items);
      },
    });
    await repository.save({ disabledOrigins: ["https://example.com"], enabled: true });
    await expect(repository.load()).resolves.toEqual({
      disabledOrigins: ["https://example.com"],
      enabled: true,
    });
  });

  it("registers only granted origins and excludes disabled sites from broad access", () => {
    expect(
      buildSelectionRegistration({ disabledOrigins: [], enabled: true }, [
        "https://allowed.example/*",
      ]),
    ).toEqual({ excludeMatches: [], matches: ["https://allowed.example/*"] });
    expect(
      buildSelectionRegistration({ disabledOrigins: ["https://blocked.example"], enabled: true }, [
        "http://*/*",
        "https://*/*",
      ]),
    ).toEqual({
      excludeMatches: ["https://blocked.example/*"],
      matches: ["http://*/*", "https://*/*"],
    });
    expect(
      buildSelectionRegistration({ disabledOrigins: [], enabled: false }, [
        "https://allowed.example/*",
      ]),
    ).toBeNull();
  });

  it("treats a granted webpage origin as turning the feature on, ignoring the gateway", () => {
    expect(grantsWebpageAccess(["http://127.0.0.1:8787/*"], "http://127.0.0.1:8787")).toBe(false);
    expect(grantsWebpageAccess([], "http://127.0.0.1:8787")).toBe(false);
    expect(
      grantsWebpageAccess(
        ["http://127.0.0.1:8787/*", "https://mail.google.com/*"],
        "http://127.0.0.1:8787",
      ),
    ).toBe(true);
    expect(grantsWebpageAccess(["https://*/*"], "http://127.0.0.1:8787")).toBe(true);
  });

  it("leaves an unchanged registration alone so a worker restart cannot close an open panel", () => {
    const desired = {
      excludeMatches: ["https://blocked.example/*"],
      matches: ["http://*/*", "https://*/*"],
    };
    expect(
      selectionRegistrationMatches(
        { excludeMatches: ["https://blocked.example/*"], matches: ["https://*/*", "http://*/*"] },
        desired,
      ),
    ).toBe(true);
    expect(selectionRegistrationMatches({ matches: ["http://*/*", "https://*/*"] }, desired)).toBe(
      false,
    );
    expect(
      selectionRegistrationMatches(
        { excludeMatches: [], matches: ["https://*/*"] },
        {
          excludeMatches: [],
          matches: ["https://*/*"],
        },
      ),
    ).toBe(true);
    expect(
      selectionRegistrationMatches(
        { excludeMatches: [], matches: ["https://a.example/*"] },
        {
          excludeMatches: [],
          matches: ["https://b.example/*"],
        },
      ),
    ).toBe(false);
  });

  it("normalizes normal webpages into Chrome match patterns", () => {
    expect(pageOriginFromUrl("https://example.com/path?q=1")).toBe("https://example.com");
    expect(originToMatchPattern("https://example.com")).toBe("https://example.com/*");
    expect(pageOriginFromUrl("chrome://settings")).toBeNull();
  });
});

describe("Selection Magic eligibility", () => {
  const base = {
    collapsed: false,
    duplicate: false,
    extensionOwned: false,
    hidden: false,
    password: false,
    supportedPage: true,
    text: "A selected paragraph",
  };

  it("accepts a bounded visible user selection", () => {
    expect(evaluateSelection(base)).toEqual({ eligible: true, text: base.text, trimmed: false });
  });

  it("trims a long selection to one translation instead of refusing it", () => {
    const eligibility = evaluateSelection({ ...base, text: "x".repeat(5_001) });
    expect(eligibility).toEqual({ eligible: true, text: "x".repeat(500), trimmed: true });
  });

  it.each([
    ["collapsed", { collapsed: true }],
    ["duplicate", { duplicate: true }],
    ["extension-owned", { extensionOwned: true }],
    ["hidden", { hidden: true }],
    ["password", { password: true }],
    ["unsupported", { supportedPage: false }],
    ["whitespace", { text: "   \n" }],
  ] as const)("rejects %s selections", (reason, change) => {
    expect(evaluateSelection({ ...base, ...change })).toEqual({ eligible: false, reason });
  });

  it("creates a stable range fingerprint without transmitting anything", () => {
    expect(selectionFingerprint("hello", { left: 10.3, top: 20.7 })).toBe("5:hello:10:21");
  });
});

describe("Selection Magic translation allowance", () => {
  it("leaves a selection within the allowance untouched", () => {
    expect(limitTranslationText("Short text.")).toEqual({ text: "Short text.", trimmed: false });
    expect(limitTranslationText("a".repeat(500))).toEqual({
      text: "a".repeat(500),
      trimmed: false,
    });
  });

  it("cuts at the last sentence end in the second half of the allowance", () => {
    const first = `${"a".repeat(300)}.`;
    expect(limitTranslationText(`${first} ${"b".repeat(400)}`)).toEqual({
      text: first,
      trimmed: true,
    });
  });

  it("recognises Devanagari sentence ends", () => {
    const first = `${"क".repeat(300)}।`;
    expect(limitTranslationText(`${first} ${"ख".repeat(400)}`)).toEqual({
      text: first,
      trimmed: true,
    });
  });

  it("falls back to a word break, then to a hard cut", () => {
    const cut = limitTranslationText("word ".repeat(120));
    expect(cut.trimmed).toBe(true);
    expect(Array.from(cut.text).length).toBeLessThanOrEqual(500);
    expect(cut.text.endsWith("word")).toBe(true);
    expect(limitTranslationText("z".repeat(900)).text).toBe("z".repeat(500));
  });

  it("counts code points, so an emoji is never split in half", () => {
    expect(limitTranslationText("😀".repeat(600)).text).toBe("😀".repeat(500));
  });
});

describe("Selection Magic sensitive-text protection", () => {
  it.each([
    ["secret", "-----BEGIN PRIVATE KEY-----"],
    ["secret", "API key sk-1234567890abcdefghijkl"],
    ["password", "password: hunter2"],
    ["one-time-code", "Your verification code is 492810"],
    ["payment-card", "Card 4111 1111 1111 1111"],
    ["identity", "Passport number 123456789"],
    ["health", "Patient ID 482910 has a diagnosis"],
  ] as const)("detects %s data", (kind, text) => {
    expect(detectSensitiveSelection(text)).toBe(kind);
  });

  it("does not warn on ordinary prose", () => {
    expect(detectSensitiveSelection("This paragraph explains photosynthesis.")).toBeNull();
  });
});

describe("Selection Magic viewport positioning and messages", () => {
  it("expires temporary selection state after five minutes", () => {
    expect(SELECTION_MAGIC_EXPIRY_MS).toBe(300_000);
  });

  it("keeps an anchored panel inside every viewport edge", () => {
    expect(
      computeAnchoredPosition({
        anchor: { bottom: 495, left: 295, right: 320, top: 475 },
        height: 180,
        viewportHeight: 500,
        viewportWidth: 320,
        width: 300,
      }),
    ).toEqual({ left: 12, top: 287 });
  });

  it("accepts only strict bounded extension messages", () => {
    expect(parseSelectionMagicMessage({ type: "lingobridge:selection-magic:ping" })).toEqual({
      type: "lingobridge:selection-magic:ping",
    });
    expect(
      parseSelectionMagicMessage({
        text: "hello",
        type: "lingobridge:selection-magic:translate",
      }),
    ).toEqual({ text: "hello", type: "lingobridge:selection-magic:translate" });
    expect(
      parseSelectionMagicMessage({ extra: true, type: "lingobridge:selection-magic:disable" }),
    ).toBeNull();
    expect(
      parseSelectionMagicMessage({
        text: "x".repeat(5_001),
        type: "lingobridge:selection-magic:translate",
      }),
    ).toBeNull();
  });
});
