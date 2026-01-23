import { describe, expect, it } from "vitest";
import { XNL } from "../src";
import { CommentNode, XnlNode } from "../src/types";

describe("XNL.stringify", () => {
  const sample = `<root a=1 { b = 2 } [ 1 2 <c> ] ( <x> )>`;

  it("produces compact single-line output by default", () => {
    const { nodes } = XNL.parseMany(sample);
    const out = XNL.stringify({ nodes });
    expect(out.includes("\n")).toBe(false);
    const parsed = XNL.parseMany(out);
    expect(parsed.nodes.length).toBe(1);
  });

  it("produces pretty output with indent", () => {
    const { nodes } = XNL.parseMany(sample);
    const out = XNL.stringify({ nodes }, { pretty: true, indent: 2 });
    expect(out.split("\n").length).toBeGreaterThan(3);
    const parsed = XNL.parseMany(out);
    expect(parsed.nodes.length).toBe(1);
  });

  it("serializes text nodes with metadata and attributes", () => {
    const node = XNL.parseSingle(`<note #nid a=1 {b=2} ?>hi</?>`).node;
    const out = XNL.stringify(node);
    expect(out).toBe(`<note #nid a=1 { b = 2 } ?>hi</?>`);
  });

  it("emits comments when provided in document", () => {
    const comment: CommentNode = { kind: "Comment", value: "note" };
    const { node } = XNL.parseSingle(`<a>`);
    const out = XNL.stringify({ nodes: [comment, node] }, { pretty: true, indent: 2 });
    expect(out).toContain("<!-- note -->");
    expect(out).toContain("<a>");
  });
});

describe("XNL namespace wrappers", () => {
  it("parses multiple nodes", () => {
    const res = XNL.parseMany(`<a><b>`);
    expect(res.nodes).toHaveLength(2);
  });

  it("parses single node", () => {
    const res = XNL.parseSingle(`<a>`);
    expect((res.node as any).tag).toBe("a");
  });

  it("parses unique children", () => {
    const res = XNL.parseUnique("root", `<a><b>`);
    const extend = (res.node as any).extend;
    expect(extend?.order).toEqual(["a", "b"]);
  });
});
