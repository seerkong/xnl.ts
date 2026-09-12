/** Grammar provenance is separate from user keys: `{ kind = "Word" }` is still a map. */
const literalObjects = new WeakSet<object>();

export function isLiteralObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && literalObjects.has(value);
}

export function markLiteralObject<T extends object>(value: T): T {
  literalObjects.add(value);
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
