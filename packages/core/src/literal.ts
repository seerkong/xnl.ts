/** JSON-compatible data, interpreted without XNL AST discriminators. */
export type XnlLiteral = null | boolean | number | string | XnlLiteral[] | { [key: string]: XnlLiteral };

export interface StringifyLiteralOptions {
  /** Sort object keys recursively; array order is always preserved. */
  readonly sortKeys?: boolean;
}

/** Serialize data as native XNL literals, including objects with a `kind` key. */
export function stringifyLiteral(value: XnlLiteral, options: StringifyLiteralOptions = {}): string {
  const ancestors = new WeakSet<object>();
  const serialize = (node: XnlLiteral): string => {
    if (node === null || typeof node === "boolean" || typeof node === "string") return JSON.stringify(node);
    if (typeof node === "number") {
      if (!Number.isFinite(node)) throw new TypeError("XNL literal numbers must be finite");
      return JSON.stringify(node);
    }
    if (typeof node !== "object") throw new TypeError("Unsupported XNL literal value");
    if (ancestors.has(node)) throw new TypeError("XNL literals cannot contain cycles");
    if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) {
      throw new TypeError("XNL literals require plain objects");
    }
    ancestors.add(node);
    try {
      if (Array.isArray(node)) return `[${Array.from(node, serialize).join(" ")}]`;
      const keys = Object.keys(node);
      if (options.sortKeys) keys.sort();
      return `{${keys.map((key) => `${JSON.stringify(key)} = ${serialize(node[key]!)}`).join(" ")}}`;
    } finally {
      ancestors.delete(node);
    }
  };
  return serialize(value);
}
