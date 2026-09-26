// Renders the LingoBridge mark into the PNG icons, maskable icons, and favicon.ico the web app
// manifest and browsers ask for. Run after changing the mark: `pnpm --filter @lingobridge/dashboard icons`.
// The outputs are committed, so builds never depend on native image tooling.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGO_GLYPH_PATH, LOGO_TILE_COLOR } from "@lingobridge/design-tokens/brand";

// sharp ships with Next.js; resolve it from there instead of adding a second copy.
const sharp = createRequire(createRequire(import.meta.url).resolve("next/package.json"))("sharp");

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconDirectory = join(appDirectory, "public", "icons");

const STANDARD_SIZES = [16, 32, 48, 96, 128, 192, 256, 384, 512];
const MASKABLE_SIZES = [192, 512];
const FAVICON_SIZES = [16, 32, 48];

/** The rounded tile, matching src/app/icon.svg. */
const standardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="${LOGO_TILE_COLOR}"/>
  <path fill="#fff" d="${LOGO_GLYPH_PATH}"/>
</svg>`;

// Launchers crop maskable icons to any shape inside a circle of 40% radius, so the tile fills the
// square and the glyph shrinks to 75% around the centre to stay inside that safe zone.
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${LOGO_TILE_COLOR}"/>
  <path fill="#fff" transform="translate(16 16) scale(0.75) translate(-16 -17.25)" d="${LOGO_GLYPH_PATH}"/>
</svg>`;

function render(svg, size) {
  return sharp(Buffer.from(svg), { density: Math.max(72, (72 * size) / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: size <= 48 })
    .toBuffer();
}

/** An ICO file holding PNG images, which every current browser reads. */
function icoFrom(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ data, size }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

await mkdir(iconDirectory, { recursive: true });

for (const size of STANDARD_SIZES) {
  await writeFile(join(iconDirectory, `icon-${size}.png`), await render(standardSvg, size));
}
for (const size of MASKABLE_SIZES) {
  await writeFile(join(iconDirectory, `maskable-${size}.png`), await render(maskableSvg, size));
}
const favicons = await Promise.all(
  FAVICON_SIZES.map(async (size) => ({ data: await render(standardSvg, size), size })),
);
await writeFile(join(appDirectory, "src", "app", "favicon.ico"), icoFrom(favicons));

console.log(
  `Wrote ${STANDARD_SIZES.length} icons, ${MASKABLE_SIZES.length} maskable icons, and favicon.ico.`,
);
