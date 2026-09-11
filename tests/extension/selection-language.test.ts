import { describe, expect, it } from "vitest";
import {
  chooseSelectionTargetLanguage,
  isSupportedSelectionTarget,
  resolveSelectionSource,
  supportedTargetsForSource,
} from "../../apps/extension/lib/selection-language";
import { fakeCapabilityCatalogue } from "../../apps/gateway/src/capabilities";
import { createNvidiaCapabilityCatalogue } from "../../apps/gateway/src/nvidia-capabilities";

const nvidia = createNvidiaCapabilityCatalogue();

describe("selection source resolution", () => {
  it("reads the selection's own language instead of guessing English", () => {
    expect(
      resolveSelectionSource("Chaque matin, Sophie prend un café chaud sur son balcon.", nvidia),
    ).toEqual({ assumed: false, code: "fr" });
  });

  it("falls back to the plain code when the catalogue has no regional variant", () => {
    expect(
      resolveSelectionSource(
        "El perro que está en la casa no quiere salir por la puerta.",
        fakeCapabilityCatalogue,
      ),
    ).toEqual({ assumed: false, code: "es" });
  });

  it("prefers Nepali over Hindi when the Devanagari words are Nepali", () => {
    expect(
      resolveSelectionSource("तपाईंलाई कस्तो छ र आज मौसम राम्रो छ", fakeCapabilityCatalogue),
    ).toEqual({ assumed: false, code: "ne" });
  });

  it("says it is assuming when the text cannot be read", () => {
    expect(resolveSelectionSource("12345", nvidia)).toEqual({ assumed: true, code: "en" });
  });

  it("says it is assuming when the detected language is not in the catalogue", () => {
    // Thai is absent from NVIDIA's own catalogue check here only if unsupported; use a language
    // the fake catalogue lacks instead, so the fallback path is what is being measured.
    expect(
      resolveSelectionSource(
        "Dette er en helt almindelig sætning og det er ikke svært at læse",
        fakeCapabilityCatalogue,
      ),
    ).toEqual({ assumed: true, code: "en" });
  });
});

describe("selection target rules", () => {
  it("offers only English as a target for a non-English source", () => {
    expect(supportedTargetsForSource(nvidia, "fr")).toEqual(["en"]);
  });

  it("offers many targets for an English source", () => {
    const targets = supportedTargetsForSource(nvidia, "en");
    expect(targets.length).toBeGreaterThan(30);
    expect(targets).toContain("hi");
    expect(targets).not.toContain("en");
  });

  it("keeps a saved target that the source can actually reach", () => {
    expect(chooseSelectionTargetLanguage(nvidia, "hi", "en")).toBe("hi");
    expect(isSupportedSelectionTarget(fakeCapabilityCatalogue, "ne")).toBe(true);
  });

  it("replaces a saved target the source cannot reach", () => {
    expect(chooseSelectionTargetLanguage(nvidia, "hi", "fr")).toBe("en");
    expect(chooseSelectionTargetLanguage(nvidia, "ne", "en")).not.toBe("ne");
  });
});
