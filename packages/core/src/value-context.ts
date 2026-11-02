import { isCapturedImmutableData } from 'immutable-data-core';

/** Grammar provenance is separate from user keys: `{ kind = "Word" }` is still a map. */
const literalObjects = new WeakSet<object>();
let literalMarkEpoch = 0n;
let capturedLiteralMarkEpoch = 0n;
const contextFreeEpochs = new WeakMap<object, bigint>();

/** Runtime invalidation version for derivations of captured XNL values.
 * Raw parser marks cannot alter a captured closure; late captured marks can. */
export function capturedLiteralContextVersion(): bigint { return capturedLiteralMarkEpoch; }

export function isLiteralObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && literalObjects.has(value);
}

/** Current syntax context is not a property of Object.freeze. Storage owners
 * that promise context-free data reads must inspect it before sharing data. */
export function hasXnlLiteralContext(root: unknown): boolean {
  // All visited objects are already retained by the input graph during this
  // synchronous traversal. A local Set avoids per-entry weak-reference work;
  // nothing is retained after the query returns.
  const seen = new Set<object>();
  // Raw graphs can execute Proxy traps while inspecting descriptors. They
  // never publish proofs for captured children discovered along the way.
  const cacheable = isCapturedImmutableData(root);
  const epoch = cacheable ? capturedLiteralMarkEpoch : literalMarkEpoch;
  const completed = new Set<object>();
  let repeated = false;
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if (isLiteralObject(value)) return true;
    const captured = isCapturedImmutableData(value);
    if (cacheable && captured && contextFreeEpochs.get(value) === epoch) return false;
    if (cacheable && completed.has(value)) return false;
    if (seen.has(value)) { repeated = true; return false; }
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (captured) { if (visit((value as any)[key])) return true; continue; }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || visit(descriptor.value)) return true;
    }
    if (cacheable && captured) completed.add(value);
    return false;
  };
  const found = visit(root);
  // A mark added during an unknown inspection invalidates that inspection;
  // conservatively require isolation rather than issuing a stale negative.
  if (epoch !== (cacheable ? capturedLiteralMarkEpoch : literalMarkEpoch)) return true;
  if (!found && cacheable && !repeated) {
    for (const value of completed) contextFreeEpochs.set(value, epoch);
  }
  return found;
}

export function markLiteralObject<T extends object>(value: T): T {
  if (!literalObjects.has(value)) {
    literalObjects.add(value);
    literalMarkEpoch++;
    // Marking a parser's new raw node cannot change any captured closure.
    // Captured nodes never contain references to unbranded mutable data.
    if (isCapturedImmutableData(value)) capturedLiteralMarkEpoch++;
  }
  return value;
}

/** An explicit literal boundary owns every nested value, including AST-shaped business objects. */
export function markLiteralTree(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  markLiteralObject(value);
  for (const key of Object.keys(value)) markLiteralTree((value as Record<string, unknown>)[key], seen);
}

/** structuredClone deliberately drops syntax provenance; internal isolation must retain it. */
export function cloneWithValueContext<T>(value: T): T {
  const clone = structuredClone(value);
  const seen = new WeakSet<object>();
  const copy = (source: unknown, target: unknown): void => {
    if (source === null || typeof source !== "object" || seen.has(source)) return;
    seen.add(source);
    if (target === null || typeof target !== "object") return;
    if (isLiteralObject(source)) markLiteralObject(target);
    for (const key of Object.keys(source)) copy((source as any)[key], (target as any)[key]);
  };
  copy(value, clone);
  return clone;
}
