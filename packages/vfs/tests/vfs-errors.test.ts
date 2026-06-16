import { describe, expect, it } from "vitest";
import { VfsError } from "../src/errors";
import { VirtualFileSystem } from "../src/vfs";

describe("vfs error codes", () => {
  it("throws ENOENT on missing path", () => {
    const vfs = new VirtualFileSystem();
    expect(() => vfs.readFile("vfs:///missing.txt")).toThrowError(VfsError);
    try {
      vfs.readFile("vfs:///missing.txt");
    } catch (err) {
      expect((err as VfsError).code).toBe("ENOENT");
    }
  });

  it("throws EISDIR when reading a folder as file", () => {
    const vfs = new VirtualFileSystem();
    vfs.mkdir("vfs:///src", { recursive: true });
    expect(() => vfs.readFile("vfs:///src")).toThrowError(VfsError);
    try {
      vfs.readFile("vfs:///src");
    } catch (err) {
      expect((err as VfsError).code).toBe("EISDIR");
    }
  });

  it("throws ENOTDIR when listing a file", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("vfs:///README.md", "hi", { fileType: "text" });
    expect(() => vfs.readdir("vfs:///README.md")).toThrowError(VfsError);
    try {
      vfs.readdir("vfs:///README.md");
    } catch (err) {
      expect((err as VfsError).code).toBe("ENOTDIR");
    }
  });

  it("throws EEXIST when overwrite is disabled", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("vfs:///a.txt", "a", { overwrite: true });
    expect(() => vfs.writeFile("vfs:///a.txt", "b", { overwrite: false })).toThrowError(VfsError);
    try {
      vfs.writeFile("vfs:///a.txt", "b", { overwrite: false });
    } catch (err) {
      expect((err as VfsError).code).toBe("EEXIST");
    }
  });

  it("throws ENOTEMPTY when removing a non-empty folder without recursive", () => {
    const vfs = new VirtualFileSystem();
    vfs.mkdir("vfs:///src", { recursive: true });
    vfs.writeFile("vfs:///src/main.ts", "export {}", { fileType: "text" });
    expect(() => vfs.rmdir("vfs:///src")).toThrowError(VfsError);
    try {
      vfs.rmdir("vfs:///src");
    } catch (err) {
      expect((err as VfsError).code).toBe("ENOTEMPTY");
    }
  });
});
