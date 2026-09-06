import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const source = resolve(projectRoot, "apps/extension/assets/icon.svg");
const outputDirectory = resolve(projectRoot, "apps/extension/public/icon");

await mkdir(outputDirectory, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(resolve(outputDirectory, `${size}.png`));
}

console.info("Generated LingoBridge extension icons.");
