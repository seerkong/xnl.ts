import { describe, expect, it } from "vitest";
import { VirtualFileSystem } from "../src/vfs";

describe("vfs path index", () => {
  it("keeps metadata id stable after rename", () => {
    const vfs = new VirtualFileSystem();
    vfs.mkdir("vfs:///src", { recursive: true });
    vfs.writeFile("vfs:///src/a.ts", "export const a = 1;", { fileType: "text" });

    const before = vfs.stat("vfs:///src/a.ts").metadataId;
    vfs.rename("vfs:///src/a.ts", "vfs:///src/b.ts");
    const after = vfs.stat("vfs:///src/b.ts").metadataId;

    expect(before).toBe(after);
    expect(vfs.getPathIndex().resolvePath(before)).toBe("vfs:///src/b.ts");
    expect(vfs.getPathIndex().resolveId("vfs:///src/b.ts")).toBe(before);
  });
});
