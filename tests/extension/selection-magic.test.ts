import { describe, expect, it } from "vitest";
import {
  buildSelectionRegistration,
  computeAnchoredPosition,
  createSelectionMagicRepository,
  detectSensitiveSelection,
  evaluateSelection,
  grantsWebpageAccess,
  normalizeSelectionMagicSettings,
  originToMatchPattern,
  pageOriginFromUrl,
  parseSelectionMagicMessage,
  selectionFingerprint,
  SELECTION_MAGIC_EXPIRY_MS,
  selectionRegistrationMatches,
} from "../../apps/extension/lib/selection-magic";

describe("Selection Magic settings and permissions", () => {
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
    expect(
      selectionRegistrationMatches({ matches: ["http://*/*", "https://*/*"] }, desired),
    ).toBe(false);
    expect(
      selectionRegistrationMatches({ excludeMatches: [], matches: ["https://*/*"] }, {
        excludeMatches: [],
        matches: ["https://*/*"],
      }),
    ).toBe(true);
    expect(
      selectionRegistrationMatches({ excludeMatches: [], matches: ["https://a.example/*"] }, {
        excludeMatches: [],
        matches: ["https://b.example/*"],
      }),
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
    expect(evaluateSelection(base)).toEqual({ eligible: true, text: base.text });
  });

  it.each([
    ["collapsed", { collapsed: true }],
    ["duplicate", { duplicate: true }],
    ["extension-owned", { extensionOwned: true }],
    ["hidden", { hidden: true }],
    ["password", { password: true }],
    ["unsupported", { supportedPage: false }],
    ["whitespace", { text: "   \n" }],
    ["oversized", { text: "x".repeat(5_001) }],
  ] as const)("rejects %s selections", (reason, change) => {
    expect(evaluateSelection({ ...base, ...change })).toEqual({ eligible: false, reason });
  });

  it("creates a stable range fingerprint without transmitting anything", () => {
    expect(selectionFingerprint("hello", { left: 10.3, top: 20.7 })).toBe("5:hello:10:21");
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
