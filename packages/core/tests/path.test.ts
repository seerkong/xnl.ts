import { describe, expect, it } from "vitest";
import { parseXnl } from "../src/parser";
import { parsePath, resolvePath, setPathValue, XnlPathError } from "../src/path";
import { wordToString } from "../src/types";

describe("path protocol", () => {
  it("parses path strings", () => {
    const parsed = parsePath("#root.section:metadata::'id'");
    expect(parsed).toEqual([
      { type: "UniqueName", value: "root.section" },
      { type: "InstanceProperty", value: "metadata" },
      { type: "MapKey", value: "id" },
    ]);
  });

  it("parses metadata selector with angle syntax", () => {
    const parsed = parsePath('<id="metadata-id-demo">:body::0');
    expect(parsed).toEqual([
      { type: "MetadataSelector", value: '<id="metadata-id-demo">' },
      { type: "InstanceProperty", value: "body" },
      { type: "ListIndex", value: "0" },
    ]);
  });

  it("resolves metadata and extend children", () => {
    const input = `<root #container {title="Root"} [
      <child #c1>
      <child #c2>
    ] (
      <header #header title="Hello">
    )>`;
    const { nodes } = parseXnl(input);
    const title = resolvePath(nodes[0], "#container:extend::'header':metadata::'title'");
    expect(title).toBe("Hello");
    const missing = () => resolvePath(nodes[0], "#missing:metadata::'id'");
    expect(missing).toThrow(XnlPathError);
  });

  it("inserts into body arrays via setPathValue", () => {
    const input = `<root #container [ <a #a1> ]>`;
    const { nodes } = parseXnl(input);
    const newChild = parseXnl(`<b #a2>`).nodes[0];
    setPathValue(nodes[0], "#container:body::1", newChild, { mode: "insert" });
    const ids = (resolvePath(nodes[0], "#container:body") as any[]).map((n) => wordToString((n as any).id));
    expect(ids).toEqual(["a1", "a2"]);
  });

  it("resolves metadata selector as single node in identity mode", () => {
    const input = `<a [ <b id="metadata-id-demo"> ]>`;
    const { nodes } = parseXnl(input);

    const found = resolvePath(nodes[0], '<id="metadata-id-demo">', { metadataIdMode: "identity" }) as any;
    expect(found.tag).toBe("b");
  });

  it("resolves metadata selector as array when mode is not identity", () => {
    const input = `<a [ <b id="metadata-id-demo"> ]>`;
    const { nodes } = parseXnl(input);

    const found = resolvePath(nodes[0], '<id="metadata-id-demo">') as any[];
    expect(Array.isArray(found)).toBe(true);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("b");
  });

  it("resolves #custom.bizid to node when id and metadata.id both exist", () => {
    const input = `<a #custom.bizid id="custom-metadata-id">`;
    const { nodes } = parseXnl(input);

    const found = resolvePath(nodes[0], "#custom.bizid") as any;
    expect(found.tag).toBe("a");
  });
});
