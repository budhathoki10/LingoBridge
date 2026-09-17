import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOGO_GLYPH_PATH, LOGO_TILE_COLOR } from "../../packages/design-tokens/brand.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("brand mark", () => {
  it.each([
    "packages/design-tokens/logo.svg",
    "apps/extension/assets/icon.svg",
    "apps/dashboard/src/app/icon.svg",
    "apps/extension/entrypoints/privacy/index.html",
  ])("uses the shared logo in %s", (file) => {
    const content = read(file);
    expect(content).toContain(LOGO_GLYPH_PATH);
    expect(content.toLowerCase()).toContain(LOGO_TILE_COLOR);
  });
});
