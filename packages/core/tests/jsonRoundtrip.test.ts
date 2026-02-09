import { describe, expect, it } from "vitest";
import { parseXnl, XNL } from "../src";

function toPlain(node: any): any {
  if (node === null) return null;
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => toPlain(n));
  if (node.kind === "Comment") return null;
  if (node.kind === "DataElement" || node.kind === "TextElement") {
    throw new Error("Unexpected element node in JSON roundtrip");
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = toPlain(v);
  }
  return out;
}

describe("formatter JSON compatibility", () => {
  it("roundtrips arbitrary JSON through stringify -> parseXnl", () => {
    const json = {
      str: "hi",
      num: 12.5,
      bool: true,
      nul: null,
      arr: [1, "x", false, { deep: [2, { z: "y" }] }],
      obj: { a: 1, b: "two" },
    };

    const literal = XNL.stringify(json);
    const wrapped = `<root { value = ${literal} }>`;
    const { nodes } = parseXnl(wrapped);
    const valueNode = (nodes[0] as any).attributes.value;
    const plain = toPlain(valueNode);

    expect(plain).toEqual(json);
  });
});
