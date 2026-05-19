import { describe, expect, it } from "vitest";
import { stringifyLineBlock, XNL } from "../src";
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

  it("roundtrips text markers that start with digits", () => {
    const node: XnlNode = {
      kind: "TextElement",
      tag: "note",
      metadata: {},
      text: "hi",
      textMarker: "01KT",
    };
    const out = XNL.stringify(node);
    expect(out).toBe(`<note ?01KT>hi</?01KT>`);
    expect((XNL.parseSingle(out).node as any).textMarker).toBe("01KT");
  });

  it("emits comments when provided in document", () => {
    const comment: CommentNode = { kind: "Comment", value: "note" };
    const { node } = XNL.parseSingle(`<a>`);
    const out = XNL.stringify({ nodes: [comment, node] }, { pretty: true, indent: 2 });
    expect(out).toContain("<!-- note -->");
    expect(out).toContain("<a>");
  });
});

describe("stringifyLineBlock", () => {
  it("keeps metadata and attributes on the opening line while formatting body children on separate lines", () => {
    const node: XnlNode = {
      kind: "DataElement",
      tag: "HistoryMessage",
      metadata: {
        version: 1,
        id: "msg_01",
        role: "assistant",
      },
      attributes: {
        source: {
          kind: "runtime",
          provider: "openai",
        },
      },
      body: [
        {
          kind: "TextElement",
          tag: "Think",
          metadata: {
            id: "msg_01.b0",
            index: 0,
          },
          text: "internal note",
        },
        {
          kind: "DataElement",
          tag: "ToolCall",
          metadata: {
            id: "msg_01.b1",
            index: 1,
            toolCallId: "call_1",
            name: "Read",
          },
          attributes: {
            input: {
              filePath: "src/app.ts",
            },
          },
        },
      ],
    };

    const out = stringifyLineBlock(node, {
      textMarkerFactory: () => "01KT0000000000000000000001",
    });

    expect(out).toBe([
      '<HistoryMessage version=1 id="msg_01" role="assistant" { source = { kind = "runtime" provider = "openai" } } [',
      '  <Think id="msg_01.b0" index=0 ?01KT0000000000000000000001>internal note</?01KT0000000000000000000001>',
      '  <ToolCall id="msg_01.b1" index=1 toolCallId="call_1" name="Read" { input = { filePath = "src/app.ts" } }>',
      "]>",
    ].join("\n"));
    const parsed = XNL.parseMany(out);
    expect(parsed.nodes).toHaveLength(1);
    const parsedNode = parsed.nodes[0] as any;
    expect(parsedNode.body).toHaveLength(2);
    expect(parsedNode.body[0].textMarker).toBe("01KT0000000000000000000001");
  });

  it("formats unique typed children with extend parens on their own lines", () => {
    const node: XnlNode = {
      kind: "DataElement",
      tag: "RuntimeEffectEvent",
      metadata: {
        version: 1,
        sequence: 1,
        kind: "request",
      },
      extend: {
        order: ["Request"],
        children: {
          Request: {
            kind: "DataElement",
            tag: "Request",
            metadata: {},
            attributes: {
              payload: {
                command: "ls",
                cwd: "/repo",
              },
            },
          },
        },
      },
    };

    const out = XNL.stringifyLineBlock(node);

    expect(out).toBe([
      '<RuntimeEffectEvent version=1 sequence=1 kind="request" (',
      '  <Request { payload = { command = "ls" cwd = "/repo" } }>',
      ")>",
    ].join("\n"));
    expect(((XNL.parseMany(out).nodes[0] as any).extend.order)).toEqual(["Request"]);
  });

  it("aligns multiline text body with the text node opening tag", () => {
    const node: XnlNode = {
      kind: "TextElement",
      tag: "Note",
      metadata: {},
      text: "line1\n  line2\n",
      textMarker: "M",
    };

    const out = stringifyLineBlock(node);

    expect(out).toBe("<Note ?M>line1\n  line2\n</?M>");
    expect((XNL.parseSingle(out).node as any).text).toBe("line1\n  line2\n");
  });

  it("aligns nested multiline text body with the nested text node opening tag", () => {
    const node: XnlNode = {
      kind: "DataElement",
      tag: "Root",
      metadata: {},
      body: [
        {
          kind: "TextElement",
          tag: "Note",
          metadata: {},
          text: "line1\nline2\n",
          textMarker: "M",
        },
      ],
    };

    const out = stringifyLineBlock(node);

    expect(out).toBe([
      "<Root [",
      "  <Note ?M>line1",
      "  line2",
      "  </?M>",
      "]>",
    ].join("\n"));
    expect((((XNL.parseSingle(out).node as any).body[0] as any).text)).toBe("line1\nline2\n");
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
