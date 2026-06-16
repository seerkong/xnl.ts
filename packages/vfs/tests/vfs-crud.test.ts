import { describe, expect, it } from "vitest";
import { VirtualFileSystem } from "../src/vfs";

describe("vfs CRUD", () => {
  it("supports file and folder lifecycle", () => {
    const vfs = new VirtualFileSystem();

    vfs.mkdir("vfs:///src/components", { recursive: true });
    vfs.writeFile("vfs:///src/components/main.ts", "export const main = true;", {
      fileType: "text",
      extend: {
        order: ["ViewExt", "SearchExt"],
        children: {
          ViewExt: { kind: "DataElement", tag: "ViewExt", metadata: { enabled: true } },
          SearchExt: { kind: "DataElement", tag: "SearchExt", metadata: { index: true } },
        },
      },
    });

    expect(vfs.exists("vfs:///src/components/main.ts")).toBe(true);
    expect(vfs.readFile("vfs:///src/components/main.ts")).toBe("export const main = true;");
    expect(vfs.readdir("vfs:///src/components").map((item) => item.name)).toEqual(["main.ts"]);
    expect(vfs.stat("vfs:///src/components/main.ts").kind).toBe("file");

    const ext = vfs.getExtend("vfs:///src/components/main.ts");
    expect(ext?.order).toEqual(["ViewExt", "SearchExt"]);

    vfs.copy("vfs:///src/components/main.ts", "vfs:///src/components/main-copy.ts");
    expect(vfs.exists("vfs:///src/components/main-copy.ts")).toBe(true);

    vfs.rename("vfs:///src/components/main-copy.ts", "vfs:///src/components/renamed.ts");
    expect(vfs.exists("vfs:///src/components/renamed.ts")).toBe(true);

    vfs.unlink("vfs:///src/components/renamed.ts");
    expect(vfs.exists("vfs:///src/components/renamed.ts")).toBe(false);
  });
});
