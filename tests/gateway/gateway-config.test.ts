import { describe, expect, it } from "vitest";
import { loadGatewayRuntimeConfig } from "../../apps/gateway/src/config";

const exactOrigin = `chrome-extension://${"a".repeat(32)}`;

describe("gateway runtime security configuration", () => {
  it("allows the fake local gateway without a fixed extension origin", () => {
    const config = loadGatewayRuntimeConfig({
      GOOGLE_CLOUD_PROJECT: "lingobridge-test",
      NVIDIA_API_KEY: "safe-test-nvidia-key",
    });

    expect(config.translationMode).toBe("fake");
    expect(config.googleProjectId).toBeNull();
    expect(config.nvidiaApiKey).toBeNull();
    expect(config.security.requireOrigin).toBe(false);
    expect(config.security.originPolicy.allows(exactOrigin)).toBe(true);
  });

  it("requires exact allowlisted extension origins in live mode", () => {
    expect(() => loadGatewayRuntimeConfig({ LINGOBRIDGE_TRANSLATION_MODE: "live" })).toThrow(
      "exact extension origin",
    );
    expect(() =>
      loadGatewayRuntimeConfig({
        LINGOBRIDGE_ALLOWED_EXTENSION_ORIGINS: "chrome-extension://*",
        NVIDIA_API_KEY: "safe-test-nvidia-key",
        LINGOBRIDGE_TRANSLATION_MODE: "live",
      }),
    ).toThrow("exact chrome-extension origins");

    const config = loadGatewayRuntimeConfig({
      LINGOBRIDGE_ALLOWED_EXTENSION_ORIGINS: exactOrigin,
      NVIDIA_API_KEY: "safe-test-nvidia-key",
      LINGOBRIDGE_TRANSLATION_MODE: "live",
    });
    expect(config.nvidiaApiKey).toBe("safe-test-nvidia-key");
    expect(config.googleProjectId).toBeNull();
    expect(config.security.requireOrigin).toBe(true);
    expect(config.security.originPolicy.allows(exactOrigin)).toBe(true);
  });

  it("requires NVIDIA credentials in live mode and validates optional Google backup project", () => {
    expect(() =>
      loadGatewayRuntimeConfig({
        LINGOBRIDGE_ALLOWED_EXTENSION_ORIGINS: exactOrigin,
        LINGOBRIDGE_TRANSLATION_MODE: "live",
      }),
    ).toThrow("NVIDIA_API_KEY");
    expect(() =>
      loadGatewayRuntimeConfig({
        GOOGLE_CLOUD_PROJECT: "projects/unsafe/path",
        NVIDIA_API_KEY: "safe-test-nvidia-key",
      }),
    ).toThrow("valid project ID");
  });

  it("rejects invalid numeric security settings", () => {
    expect(() => loadGatewayRuntimeConfig({ LINGOBRIDGE_PROVIDER_TIMEOUT_MS: "0" })).toThrow(
      "positive integer",
    );
  });
});
