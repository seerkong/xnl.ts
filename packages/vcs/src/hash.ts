import { createHash } from "node:crypto";

export type ObjectId = string;

export function sha256Hex(input: string | Uint8Array): ObjectId {
  return createHash("sha256").update(input).digest("hex");
}

function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort((a, b) => compareUtf16CodeUnits(a[0], b[0]));
  const inner = entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",");
  return `{${inner}}`;
}

export function hashObject(value: unknown): ObjectId {
  return sha256Hex(stableStringify(value));
}

export function canonicalizeObject<T>(value: T): { canonical: string; hash: ObjectId } {
  const canonical = stableStringify(value);
  return {
    canonical,
    hash: sha256Hex(canonical),
  };
}
