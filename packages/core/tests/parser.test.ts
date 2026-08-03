import { describe, expect, it } from "vitest";
import { stringify as stringifyLineBlock } from "../src/lineBlockFormatter";
import { parseUniqueChildren, parseXnl, parseXnlSingleNode } from "../src/parser";

describe("parseXnl", () => {
  it("parses mixed short-form content with metadata, attributes, array, extend, and text", () => {
    const input = `<doc [
  <no_body_node1>
  <no_body_node2 a=[1] b={c=3}>
  <metadata_demo1 xx=Base.Flow {
    a = 'abc'
    b = "tt\\t\\n"
    c = { inner = 2 }
    "string as key" = 2.3
    'string as key2' = 3.4
  }>
  <list_body1 [
    1 2 <item count=3 active=true note="hi">
  ]>
  <extend_demo1 (
    <abc {
      a = [1 2]
      b = {c = 3}
    }>
    <efg [
      1
      <b>
    ]>
  )>
  <text1 ?>
    plain text with symbols & < > # ?
    can include <notatag and stay as text
  </?>
]>`;

    const doc = parseXnl(input);
    expect(doc.nodes).toHaveLength(1);
    const root = doc.nodes[0] as any;
    expect(root.body).toBeDefined();
    expect(root.extend).toBeUndefined();
    expect(root.text).toBeUndefined();
    const list = (root.body as any[]).find((n: any) => n.tag === "list_body1") as any;
    expect(list.body).toHaveLength(3);
    const ext = (root.body as any[]).find((n: any) => n.tag === "extend_demo1") as any;
    expect(ext.extend?.order).toEqual(["abc", "efg"]);
    const textNode = (root.body as any[]).find((n: any) => n.text !== undefined) as any;
    expect(textNode.text).toContain("plain text with symbols");
  });

  it("overwrites duplicate children in extend blocks (warn only)", () => {
    const input = `<wrap ( <a {v=1}> <a {v=2}> )>`;
    const { nodes, warnings = [] } = parseXnl(input);
    const wrap = nodes[0] as any;
    expect(wrap.extend?.children.a?.attributes?.v).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("DUPLICATE_CHILD");
  });

  it("parses metadata and attribute literals with quoted keys and numeric kinds", () => {
    const input = `<node a=[1] b={c=3} { s = 'abc' "quoted key" = 2.3 bool = false arr = [1 "x"] }>`;
    const doc = parseXnl(input);
    const node = doc.nodes[0] as any;
    expect(Array.isArray(node.metadata.a)).toBe(true);
    expect(typeof node.metadata.b).toBe("object");
    expect(node.attributes?.s).toBe("abc");
    expect(node.attributes?.["quoted key"]).toBe(2.3);
    expect(node.attributes?.bool).toBe(false);
  });

  it("errors on mismatched text marker or mixed text with array/extend", () => {
    expect(() => parseXnl(`<t ?flag>hi</?other>`)).toThrowError(/expected 'flag' but found 'other'/i);
    expect(() => parseXnl(`<t [ 1 ] ?>hi</?>`)).toThrowError(/text block not allowed with array\/extend/i);
    expect(() => parseXnl(`<t ( <a> ) ?>hi</?>`)).toThrowError(/text block not allowed with array\/extend/i);
  });

  it("treats non-matching text closers as content until the matching marker", () => {
    const input = `<t ?flag>before <desc ?>nested</?> middle </?other> after</?flag>`;
    const node = parseXnl(input).nodes[0] as any;

    expect(node.textMarker).toBe("flag");
    expect(node.text).toBe("before <desc ?>nested</?> middle </?other> after");
  });

  it("round-trips text containing close-like XNL through a generated marker", () => {
    const text = "before <desc ?>nested</?> middle </?other> after";
    const serialized = stringifyLineBlock({
      kind: "TextElement",
      tag: "Think",
      metadata: {},
      text,
    }, {
      textMarkerFactory: () => "MARK",
    });

    expect(serialized).toContain("<Think ?MARK>");
    expect((parseXnl(serialized).nodes[0] as any).text).toBe(text);
  });

  it("accepts text markers that start with digits", () => {
    const { nodes } = parseXnl(`<t ?01KT>hi</?01KT>`);
    expect((nodes[0] as any).textMarker).toBe("01KT");
    expect((nodes[0] as any).text).toBe("hi");
  });

  it("parses bare identifier literals as words", () => {
    const doc = parseXnl(`<a v=abc.d>`).nodes[0] as any;
    expect(doc.metadata.v.kind).toBe("Word");
    expect(doc.metadata.v.namespace).toEqual(["abc"]);
    expect(doc.metadata.v.name).toBe("d");
  });

  it("reports missing closing delimiters with tag context", () => {
    expect(() => parseXnl(`<a [ 1 2`)).toThrowError(/Missing closing text tag|Missing closing .*<a>/i);
    expect(() => parseXnl(`<note?>hi`)).toThrowError(/Missing closing text tag <\/\?> for <note>/i);
  });

  it("dedents text blocks based on closing indent", () => {
    const input = `<note?>
      line1
        line2
    </?>`;
    const { nodes } = parseXnl(input);
    const note = nodes[0] as any;
    expect(note.text).toBe("  line1\n    line2\n");
  });

  it("parses a single node with parseXnlSingleNode", () => {
    const { node, warnings = [] } = parseXnlSingleNode(`<item a=1 {b=2} [3]>`);
    expect((node as any).tag).toBe("item");
    expect((node as any).metadata.a).toBe(1);
    expect((node as any).body).toBeDefined();
    expect(warnings).toHaveLength(0);
  });

  it("builds extend body with override on duplicate using parseUniqueChildren", () => {
    const { node, warnings = [] } = parseUniqueChildren("root", `<a {x=1}> <a {x=2}> <b>`);
    expect((node as any).extend?.order).toEqual(["a", "b"]);
    expect((node as any).extend?.children.a?.attributes?.x).toBe(2);
    expect(warnings).toHaveLength(1);
  });
});
