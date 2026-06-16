import { describe, expect, it } from "vitest";
import { basenameVfsPath, dirnameVfsPath, joinVfsPath, normalizeVfsPath, relativeVfsPath, toSegments, VFS_ROOT } from "../src/path";

describe("vfs path utilities", () => {
  it("normalizes root with slash", () => {
    expect(normalizeVfsPath("vfs:///")).toBe("vfs:///");
  });

  it("normalizes dot segments", () => {
    expect(normalizeVfsPath("vfs:///src/./main.ts")).toBe("vfs:///src/main.ts");
  });

  it("normalizes parent segments", () => {
    expect(normalizeVfsPath("vfs:///src/../README.md")).toBe("vfs:///README.md");
  });

  it("normalizes duplicate slashes", () => {
    expect(normalizeVfsPath("vfs:////src///main.ts")).toBe("vfs:///src/main.ts");
  });

  it("normalizes windows separators", () => {
    expect(normalizeVfsPath("vfs:///\\src\\main.ts")).toBe("vfs:///src/main.ts");
  });

  it("keeps plain root stable", () => {
    expect(normalizeVfsPath("vfs:///")).toBe("vfs:///");
  });

  it("joins nested paths", () => {
    expect(joinVfsPath("vfs:///src", "../docs", "guide.md")).toBe("vfs:///docs/guide.md");
  });

  it("dirname returns parent path", () => {
    expect(dirnameVfsPath("vfs:///src/main.ts")).toBe("vfs:///src");
  });

  it("dirname of root stays root", () => {
    expect(dirnameVfsPath(VFS_ROOT)).toBe("vfs:///");
  });

  it("basename returns file name", () => {
    expect(basenameVfsPath("vfs:///src/main.ts")).toBe("main.ts");
  });

  it("basename of root is empty", () => {
    expect(basenameVfsPath(VFS_ROOT)).toBe("");
  });

  it("relative between sibling files", () => {
    expect(relativeVfsPath("vfs:///src/main.ts", "vfs:///src/util.ts")).toBe("../util.ts");
  });

  it("relative to same path is dot", () => {
    expect(relativeVfsPath("vfs:///src", "vfs:///src")).toBe(".");
  });

  it("toSegments strips slash root", () => {
    expect(toSegments("vfs:///src/main.ts")).toEqual(["src", "main.ts"]);
  });

  it("toSegments on root returns empty", () => {
    expect(toSegments("vfs:///")).toEqual([]);
  });
});
