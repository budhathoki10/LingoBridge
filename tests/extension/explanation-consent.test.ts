import { describe, expect, it } from "vitest";
import {
  createExplanationConsentRepository,
  EXPLANATION_CONSENT_VERSION,
} from "../../apps/extension/lib/explanation-consent";
import type { ConsentStorage } from "../../apps/extension/lib/online-consent";

class MemoryConsentStorage implements ConsentStorage {
  readonly values: Record<string, unknown> = {};

  async get(): Promise<Record<string, unknown>> {
    return { ...this.values };
  }

  async remove(key: string): Promise<void> {
    delete this.values[key];
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
}

describe("explanation consent", () => {
  it("is absent until accepted, names NVIDIA Nemotron, and is independent of translation consent", async () => {
    const storage = new MemoryConsentStorage();
    storage.values.lingobridgeOnlineProviderConsent = { google: true };
    const repository = createExplanationConsentRepository(storage);

    expect(await repository.load()).toBeNull();
    const consent = await repository.accept();
    expect(consent).toMatchObject({ nvidia: true, version: EXPLANATION_CONSENT_VERSION });
    expect(await repository.load()).toEqual(consent);

    await repository.revoke();
    expect(await repository.load()).toBeNull();
    expect(storage.values.lingobridgeOnlineProviderConsent).toEqual({ google: true });
  });

  it("ignores consent from an older version", async () => {
    const storage = new MemoryConsentStorage();
    storage.values.lingobridgeExplanationConsent = {
      acceptedAt: "2026-01-01T00:00:00.000Z",
      nvidia: true,
      version: "explain-nvidia-nemotron-v0",
    };
    expect(await createExplanationConsentRepository(storage).load()).toBeNull();
  });
});
