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
    ).toEqual({ assumed: false, code: "fr", romanizedNepali: null });
  });

  it("falls back to the plain code when the catalogue has no regional variant", () => {
    expect(
      resolveSelectionSource(
        "El perro que está en la casa no quiere salir por la puerta.",
        fakeCapabilityCatalogue,
      ),
    ).toEqual({ assumed: false, code: "es", romanizedNepali: null });
  });

  it("prefers Nepali over Hindi when the Devanagari words are Nepali", () => {
    expect(
      resolveSelectionSource("तपाईंलाई कस्तो छ र आज मौसम राम्रो छ", fakeCapabilityCatalogue),
    ).toEqual({ assumed: false, code: "ne", romanizedNepali: null });
  });

  it("normalizes common Romanized Nepali before translation", () => {
    expect(resolveSelectionSource("ma ghar jadai chu", fakeCapabilityCatalogue)).toMatchObject({
      assumed: false,
      code: "ne",
      romanizedNepali: {
        text: "म घर जाँदै छु",
      },
    });
    expect(resolveSelectionSource("Ma bhaat khadaichu", fakeCapabilityCatalogue)).toMatchObject({
      code: "ne",
      romanizedNepali: {
        text: "म भात खाँदै छु",
      },
    });
    expect(
      resolveSelectionSource(
        "Sathi, timro naam k ho ani timilai k xa? Ma aba ghara janxu ani afno kaam garxu",
        fakeCapabilityCatalogue,
      ),
    ).toMatchObject({
      code: "ne",
      romanizedNepali: {
        text: "साथी, तिम्रो नाम के हो अनि तिमीलाई के छ? म अब घर जान्छु अनि आफ्नो काम गर्छु",
      },
    });
  });

  it("says it is assuming when the text cannot be read", () => {
    expect(resolveSelectionSource("12345", nvidia)).toEqual({
      assumed: true,
      code: "en",
      romanizedNepali: null,
    });
  });

  it("says it is assuming when the detected language is not in the catalogue", () => {
    // Thai is absent from NVIDIA's own catalogue check here only if unsupported; use a language
    // the fake catalogue lacks instead, so the fallback path is what is being measured.
    expect(
      resolveSelectionSource(
        "Dette er en helt almindelig sætning og det er ikke svært at læse",
        fakeCapabilityCatalogue,
      ),
    ).toEqual({ assumed: true, code: "en", romanizedNepali: null });
  });
});

describe("selection target rules", () => {
  it("exposes the complete reviewed MyMemory compatibility catalogue", () => {
    expect(nvidia.googlePairing).toBe("all-listed");
    expect(nvidia.languages.length).toBeGreaterThanOrEqual(322);
    expect(nvidia.languages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ace-ID", myMemorySource: true, myMemoryTarget: true }),
        expect.objectContaining({ code: "ne-NP", myMemorySource: true, myMemoryTarget: true }),
        expect.objectContaining({ code: "zu-ZA", myMemorySource: true, myMemoryTarget: true }),
      ]),
    );
  });

  it("offers MyMemory targets for a non-English source", () => {
    const targets = supportedTargetsForSource(nvidia, "fr");
    expect(targets.length).toBeGreaterThanOrEqual(321);
    expect(targets).toContain("en");
    expect(targets).toContain("ne");
    expect(targets).not.toContain("fr");
  });

  it("offers the complete MyMemory target list for an English source", () => {
    const targets = supportedTargetsForSource(nvidia, "en");
    expect(targets.length).toBeGreaterThan(300);
    expect(targets).toContain("hi");
    expect(targets).toContain("ne-NP");
    expect(targets).toContain("zu-ZA");
    expect(targets).not.toContain("en");
  });

  it("keeps a saved target that the source can actually reach", () => {
    expect(chooseSelectionTargetLanguage(nvidia, "hi", "en")).toBe("hi");
    expect(chooseSelectionTargetLanguage(nvidia, "hi", "fr")).toBe("hi");
    expect(isSupportedSelectionTarget(fakeCapabilityCatalogue, "ne")).toBe(true);
  });

  it("replaces a saved target that matches the source", () => {
    expect(chooseSelectionTargetLanguage(nvidia, "fr", "fr")).not.toBe("fr");
    expect(chooseSelectionTargetLanguage(nvidia, "ne", "en")).toBe("ne");
  });
});
