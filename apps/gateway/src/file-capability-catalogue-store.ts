import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CapabilityCatalogue } from "@lingobridge/contracts";
import type { CapabilityCatalogueStore } from "./capability-catalogue-service.js";

export class FileCapabilityCatalogueStore implements CapabilityCatalogueStore {
  constructor(private readonly path: string) {}

  async load(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      return null;
    }
  }

  async save(catalogue: CapabilityCatalogue): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(catalogue)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}
