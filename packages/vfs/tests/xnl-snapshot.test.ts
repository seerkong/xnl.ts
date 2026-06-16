import { describe, expect, it } from "vitest";
import { deserializeVfsSnapshot, deserializeVfsSnapshotFromString, serializeVfsSnapshot, serializeVfsSnapshotToString } from "../src/xnl-snapshot";
import { VirtualFileSystem } from "../src/vfs";

function hasChildTag(node: { body?: unknown[] }, tag: string): boolean {
  for (const child of node.body ?? []) {
    if (child && typeof child === "object" && (child as { kind?: string; tag?: string }).kind === "DataElement" && (child as { tag?: string }).tag === tag) {
      return true;
    }
  }
  return false;
}

function firstChildByTag(node: { body?: unknown[] }, tag: string): { metadata?: Record<string, unknown>; attributes?: Record<string, unknown> } | undefined {
  for (const child of node.body ?? []) {
    if (child && typeof child === "object" && (child as { kind?: string; tag?: string }).kind === "DataElement" && (child as { tag?: string }).tag === tag) {
      return child as { metadata?: Record<string, unknown>; attributes?: Record<string, unknown> };
    }
  }
  return undefined;
}

function findFileByName(node: { body?: unknown[] }, fileName: string): { body?: unknown[]; metadata?: Record<string, unknown> } | undefined {
  for (const child of node.body ?? []) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const element = child as { kind?: string; tag?: string; body?: unknown[]; metadata?: Record<string, unknown> };
    if (element.kind !== "DataElement") {
      continue;
    }
    if (element.tag === "File" && element.metadata?.name === fileName) {
      return element;
    }
    const found = findFileByName(element, fileName);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe("vfs xnl snapshot", () => {
  it("serializes and deserializes full snapshot without loss", () => {
    const vfs = new VirtualFileSystem();
    vfs.mkdir("vfs:///src", { recursive: true });
    vfs.mkdir("vfs:///assets", { recursive: true });
    vfs.writeFile("vfs:///src/main.ts", "export const main = 1;", { fileType: "text" });
    vfs.writeFile("vfs:///src/schema.xnl", "<Root { answer = 42 }>", { fileType: "xnl" });
    vfs.writeFile("vfs:///assets/logo.bin", "AAECAw==", { fileType: "binary" });

    const original = vfs.getSnapshot();
    const serialized = serializeVfsSnapshot(original, { mode: "full" });
    const restored = deserializeVfsSnapshot(serialized);

    expect(serialized.tag).toBe("VfsSnapshot");
    expect(hasChildTag(serialized, "Contents")).toBe(true);

    const mainFile = findFileByName(serialized, "main.ts");
    expect(mainFile).toBeDefined();
    const contentLink = firstChildByTag(mainFile ?? {}, "Content");
    expect(contentLink).toBeDefined();
    expect(typeof contentLink?.metadata?.refId).toBe("string");
    expect(contentLink?.metadata?.id).toBeUndefined();
    expect(typeof contentLink?.attributes?.hash).toBe("string");

    expect(restored).toEqual(original);
  });

  it("supports string roundtrip and manifest mode", () => {
    const vfs = new VirtualFileSystem();
    vfs.mkdir("vfs:///docs", { recursive: true });
    vfs.writeFile("vfs:///docs/README.md", "# hello", { fileType: "text" });

    const snapshot = vfs.getSnapshot();
    const manifest = serializeVfsSnapshot(snapshot, { mode: "manifest" });
    expect(hasChildTag(manifest, "Contents")).toBe(false);

    const text = serializeVfsSnapshotToString(snapshot, { mode: "full" });
    const restored = deserializeVfsSnapshotFromString(text);
    expect(restored).toEqual(snapshot);
  });

});
