import { describe, expect, it } from "vitest";
import { parseXnl, stringifyLiteral, XNL, type DataElementNode, type XnlLiteral } from "../src/index";

const read = (text: string) => (parseXnl(`<Value { data = ${text} }>`).nodes[0] as DataElementNode).attributes!.data;

describe("explicit native literal serialization", () => {
  it("roundtrips AST-shaped objects as literal data with reserved and quoted keys", () => {
    const value = JSON.parse(`{"kind":"DataElement","tag":"Hidden","metadata":{},"attributes":{"nodes":[],"kind":"Word"},"__proto__":{"polluted":true},"constructor":{"prototype":{"flag":true}},"a'b":"quote"}`);
    expect(read(stringifyLiteral(value, { sortKeys: true }))).toEqual(value);
    const parsed = read(stringifyLiteral(value)) as object;
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("preserves control characters, Unicode and recursive key order without sorting arrays", () => {
    const value = { z: "\r\n\t\b\f\0\u0001\ud800你好", a: [{ z: 2, a: 1 }, false, null] };
    const text = stringifyLiteral(value, { sortKeys: true });
    expect(read(text)).toEqual(value);
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"z"'));
    expect(stringifyLiteral({ a: value.a, z: value.z }, { sortKeys: true })).toBe(text);
    expect(XNL.stringifyLiteral(value)).toBe(stringifyLiteral(value));
  });

  it.each([NaN, Infinity, undefined, new Date(), [undefined], new Array(1)])("rejects unsupported values instead of dropping data", (value) => {
    expect(() => stringifyLiteral(value as XnlLiteral)).toThrow(TypeError);
  });

  it("rejects cycles but allows repeated acyclic values", () => {
    const cycle: XnlLiteral[] = []; cycle.push(cycle);
    expect(() => stringifyLiteral(cycle)).toThrow(/cycles/);
    const shared = { a: 1 };
    expect(read(stringifyLiteral([shared, shared]))).toEqual([shared, shared]);
  });

  it("keeps ordinary unknown kind fields in the general formatter", () => {
    const value = { kind: "policy", values: [true] };
    expect(read(XNL.stringify(value))).toEqual(value);
  });

  it("preserves reserved keys in metadata and attribute maps", () => {
    const root = parseXnl('<Value "__proto__"={ x=true } { "__proto__"={ y=true } }> ').nodes[0] as DataElementNode;
    expect(Object.prototype.hasOwnProperty.call(root.metadata, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(root.attributes!, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(root.metadata)).toBe(Object.prototype);
  });
});
