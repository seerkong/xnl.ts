import type { DataElementNode } from "xnl-core";
import { VcsError } from "./errors";

export type LosslessAstValue =
  | { readonly type: "undefined" }
  | { readonly type: "null" }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: string }
  | { readonly type: "array"; readonly items: readonly LosslessAstValue[] }
  | { readonly type: "object"; readonly entries: readonly LosslessAstObjectEntry[] };

export interface LosslessAstObjectEntry {
  readonly key: string;
  readonly value: LosslessAstValue;
}

function codecError(message: string): VcsError {
  return new VcsError("EINVAL", message);
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

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlainDataObject(value: object): void {
  if (!isPlainObject(value)) {
    throw codecError("xnl-vfs-v2 payload only supports plain objects");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw codecError("xnl-vfs-v2 payload does not support symbol keys");
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw codecError("xnl-vfs-v2 payload only supports enumerable data properties");
    }
  }
}

function assertExactOwnKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  context: string,
): void {
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw codecError(`xnl-vfs-v2 ${context} must use exact own keys`);
  }
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codecError(`xnl-vfs-v2 ${context} must be an object`);
  }
  assertPlainDataObject(value);
  return value as Record<string, unknown>;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function encodeNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "-0";
  }
  if (Number.isNaN(value)) {
    return "NaN";
  }
  if (value === Infinity) {
    return "Infinity";
  }
  if (value === -Infinity) {
    return "-Infinity";
  }
  return String(value);
}

function decodeNumber(value: string): number {
  if (value === "-0") {
    return -0;
  }
  if (value === "NaN") {
    return NaN;
  }
  if (value === "Infinity") {
    return Infinity;
  }
  if (value === "-Infinity") {
    return -Infinity;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || String(parsed) !== value) {
    throw codecError("xnl-vfs-v2 payload has malformed number encoding");
  }
  return parsed;
}

function assertArrayShape(value: readonly unknown[]): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw codecError("xnl-vfs-v2 payload does not support symbol keys");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw codecError("xnl-vfs-v2 payload does not support sparse arrays");
    }
  }
  const allowed = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw codecError("xnl-vfs-v2 payload array items must be enumerable data properties");
    }
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) {
      throw codecError("xnl-vfs-v2 payload does not support custom array properties");
    }
  }
}

function encodeLosslessAstValue(value: unknown, seen: WeakSet<object>): LosslessAstValue {
  if (value === undefined) {
    return { type: "undefined" };
  }
  if (value === null) {
    return { type: "null" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  if (typeof value === "string") {
    return { type: "string", value };
  }
  if (typeof value === "number") {
    return { type: "number", value: encodeNumber(value) };
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw codecError(`xnl-vfs-v2 payload cannot encode ${typeof value}`);
  }
  if (typeof value !== "object") {
    throw codecError("xnl-vfs-v2 payload contains unsupported value");
  }
  if (seen.has(value)) {
    throw codecError("xnl-vfs-v2 payload cannot encode cyclic values");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      assertArrayShape(value);
      return {
        type: "array",
        items: value.map((item) => encodeLosslessAstValue(item, seen)),
      };
    }

    assertPlainDataObject(value);
    const record = value as Record<string, unknown>;
    return {
      type: "object",
      entries: Object.keys(record)
        .sort(compareUtf16CodeUnits)
        .map((key) => ({
          key,
          value: encodeLosslessAstValue(record[key], seen),
        })),
    };
  } finally {
    seen.delete(value);
  }
}

export function encodeLosslessVfsSnapshot(snapshot: DataElementNode): LosslessAstValue {
  return encodeLosslessAstValue(snapshot, new WeakSet());
}

function decodeLosslessAstValue(encoded: unknown): unknown {
  const record = requireRecord(encoded, "payload node");
  if (!hasOwn(record, "type")) {
    throw codecError("xnl-vfs-v2 payload node is missing own type");
  }
  const type = record.type;
  switch (type) {
    case "undefined":
      assertExactOwnKeys(record, ["type"], "undefined payload");
      return undefined;
    case "null":
      assertExactOwnKeys(record, ["type"], "null payload");
      return null;
    case "boolean":
      assertExactOwnKeys(record, ["type", "value"], "boolean payload");
      if (typeof record.value !== "boolean") {
        throw codecError("xnl-vfs-v2 boolean payload is malformed");
      }
      return record.value;
    case "string":
      assertExactOwnKeys(record, ["type", "value"], "string payload");
      if (typeof record.value !== "string") {
        throw codecError("xnl-vfs-v2 string payload is malformed");
      }
      return record.value;
    case "number":
      assertExactOwnKeys(record, ["type", "value"], "number payload");
      if (typeof record.value !== "string") {
        throw codecError("xnl-vfs-v2 number payload is malformed");
      }
      return decodeNumber(record.value);
    case "array":
      assertExactOwnKeys(record, ["type", "items"], "array payload");
      if (!Array.isArray(record.items)) {
        throw codecError("xnl-vfs-v2 array payload is malformed");
      }
      assertArrayShape(record.items);
      return record.items.map((item) => decodeLosslessAstValue(item));
    case "object": {
      assertExactOwnKeys(record, ["type", "entries"], "object payload");
      if (!Array.isArray(record.entries)) {
        throw codecError("xnl-vfs-v2 object payload is malformed");
      }
      assertArrayShape(record.entries);
      const out: Record<string, unknown> = {};
      const seenKeys = new Set<string>();
      for (const entry of record.entries) {
        const entryRecord = requireRecord(entry, "object entry");
        assertExactOwnKeys(entryRecord, ["key", "value"], "object entry");
        if (typeof entryRecord.key !== "string") {
          throw codecError("xnl-vfs-v2 object entry key is malformed");
        }
        if (seenKeys.has(entryRecord.key)) {
          throw codecError("xnl-vfs-v2 object payload contains duplicate keys");
        }
        seenKeys.add(entryRecord.key);
        Object.defineProperty(out, entryRecord.key, {
          value: decodeLosslessAstValue(entryRecord.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    default:
      throw codecError("xnl-vfs-v2 payload has unsupported value tag");
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasNonEmptyStringOwnField(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return hasOwn(value, key) && typeof value[key] === "string" && value[key].length > 0;
}

function assertVfsFolderRoot(value: unknown): asserts value is DataElementNode {
  if (!isRecordValue(value)) {
    throw codecError("xnl-vfs-v2 payload root must be a VFS folder snapshot");
  }
  if (
    !hasOwn(value, "kind") ||
    !hasOwn(value, "tag") ||
    value.kind !== "DataElement" ||
    value.tag !== "folder"
  ) {
    throw codecError("xnl-vfs-v2 payload root must be a VFS folder snapshot");
  }
  if (!hasOwn(value, "metadata") || !isRecordValue(value.metadata)) {
    throw codecError("xnl-vfs-v2 payload root metadata is malformed");
  }
  if (
    !hasNonEmptyStringOwnField(value.metadata, "id") ||
    !hasNonEmptyStringOwnField(value.metadata, "name")
  ) {
    throw codecError("xnl-vfs-v2 payload root metadata.id and metadata.name are required");
  }
}

export function decodeLosslessVfsSnapshot(encoded: unknown): DataElementNode {
  const decoded = decodeLosslessAstValue(encoded);
  assertVfsFolderRoot(decoded);
  return decoded;
}
