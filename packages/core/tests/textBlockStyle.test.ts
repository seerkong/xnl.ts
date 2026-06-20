import { describe, expect, it } from "vitest";
import { parseXnl, stringifyLineBlock } from "../src";
import type { TextElementNode } from "../src/types";

describe("textBlockStyle option (block text rendering + symmetric parse)", () => {
  // A modeling component: single-line IO blocks + a multi-line runtime block + a mermaid-like nested block.
  const source = `<component #orders.place_order kind="component" [
  <desc ?d>下单标准组件：output = fn(runtime, input, config)。</?d>
  <runtime ?rt>
  interface PlaceOrderRuntime {
    orderStore: OrderStore
    clock: Clock
  }
  </?rt>
  <input ?in>interface PlaceOrderInput { cart: CartLine[] }</?in>
  <config ?cfg>interface PlaceOrderConfig { allowBackorder: boolean }</?cfg>
  <output ?out>interface PlaceOrderOutput { order: Order }</?out>
]>`;

  const expected = `<component #orders.place_order kind="component" [
  <desc ?d>
  下单标准组件：output = fn(runtime, input, config)。
  </?d>
  <runtime ?rt>
  interface PlaceOrderRuntime {
    orderStore: OrderStore
    clock: Clock
  }
  </?rt>
  <input ?in>
  interface PlaceOrderInput { cart: CartLine[] }
  </?in>
  <config ?cfg>
  interface PlaceOrderConfig { allowBackorder: boolean }
  </?cfg>
  <output ?out>
  interface PlaceOrderOutput { order: Order }
  </?out>
]>`;

  const fmt = (input: string) =>
    stringifyLineBlock(parseXnl(input, { textBlockStyle: true }), { textBlockStyle: true });

  it("renders every text element in block style, even single-line ones", () => {
    expect(fmt(source)).toBe(expected);
  });

  it("is idempotent (already-block input formats to itself)", () => {
    expect(fmt(expected)).toBe(expected);
  });

  it("round-trips: parse(format(x)) preserves clean (dedented, no structural newline) text", () => {
    const doc = parseXnl(source, { textBlockStyle: true });
    const reparsed = parseXnl(fmt(source), { textBlockStyle: true });
    const text = (d: typeof doc, tag: string) =>
      (d.nodes[0] as any).body.find((n: TextElementNode) => n.tag === tag)?.text;
    for (const tag of ["desc", "runtime", "input", "config", "output"]) {
      expect(text(reparsed, tag)).toBe(text(doc, tag));
    }
    // single-line IO block stored without surrounding newlines/indent
    expect(text(doc, "input")).toBe("interface PlaceOrderInput { cart: CartLine[] }");
    // multi-line runtime: dedented, no trailing structural newline
    expect(text(doc, "runtime")).toBe(
      "interface PlaceOrderRuntime {\n  orderStore: OrderStore\n  clock: Clock\n}",
    );
  });

  it("default (no option) keeps legacy inline-open rendering", () => {
    const out = stringifyLineBlock(parseXnl(source), {});
    expect(out).toContain("<input ?in>interface PlaceOrderInput { cart: CartLine[] }</?in>");
  });
});
