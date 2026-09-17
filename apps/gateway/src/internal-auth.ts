import { createHash, timingSafeEqual } from "node:crypto";

/** Compares digests so neither the secret's length nor its prefix leaks through timing. */
export function safeEqualSecret(presented: string, expected: string): boolean {
  const left = createHash("sha256").update(presented, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}
