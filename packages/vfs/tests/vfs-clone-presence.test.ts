import type { DataElementNode, TextElementNode } from "xnl-core";
import { describe, expect, it } from "vitest";
import { areXnlSnapshotsStructurallyEqual } from "../src/revisioned-persistence";
import { VirtualFileSystem } from "../src/vfs";

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function explicitUndefinedSnapshot(): DataElementNode {
  const text: TextElementNode = {
    kind: "TextElement",
    tag: "LooseText",
    metadata: {},
    text: undefined,
    textMarker: undefined,
  };

  return {
    kind: "DataElement",
    tag: "folder",
    id: undefined,
    metadata: {
      id: "root",
      name: "project",
    },
    attributes: {
      nodeType: "folder",
    },
    body: [
      {
        kind: "DataElement",
        tag: "folder",
        metadata: {
          id: "child",
          name: "child",
        },
        attributes: {
          nodeType: "folder",
        },
        body: undefined,
      },
      text,
    ],
  };
}

describe("VirtualFileSystem clone boundaries", () => {
  it("preserves own properties whose value is explicit undefined", () => {
    const source = explicitUndefinedSnapshot();
    const fromConstructor = new VirtualFileSystem(source).getSnapshot();

    expect(hasOwn(fromConstructor, "id")).toBe(true);
    expect(hasOwn(fromConstructor.body?.[0] as DataElementNode, "body")).toBe(true);
    expect(hasOwn(fromConstructor.body?.[1] as TextElementNode, "text")).toBe(true);
    expect(hasOwn(fromConstructor.body?.[1] as TextElementNode, "textMarker")).toBe(true);
    expect(areXnlSnapshotsStructurallyEqual(fromConstructor, source)).toBe(true);

    const target = new VirtualFileSystem();
    target.loadSnapshot(source);
    const loaded = target.getSnapshot();

    expect(hasOwn(loaded, "id")).toBe(true);
    expect(hasOwn(loaded.body?.[0] as DataElementNode, "body")).toBe(true);
    expect(hasOwn(loaded.body?.[1] as TextElementNode, "text")).toBe(true);
    expect(hasOwn(loaded.body?.[1] as TextElementNode, "textMarker")).toBe(true);
    expect(areXnlSnapshotsStructurallyEqual(loaded, source)).toBe(true);
  });
});
