import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseXnl, type DataElementNode } from "xnl-core";
import { describe, expect, it } from "vitest";
import { VfsError } from "../src/errors";
import { LocalFsVfsPersistence } from "../src/local-fs-persistence";
import { readMetadataId } from "../src/model";
import { VirtualFileSystem } from "../src/vfs";

function shouldKeepTempDir(): boolean {
  return process.env.VFS_TEST_KEEP_TEMP_DIR === "1";
}

function logTempDir(label: string, dirPath: string): void {
  if (shouldKeepTempDir()) {
    console.log(`[local-fs-persistence] ${label}: ${dirPath}`);
    const markerPath = process.env.VFS_TEST_TEMP_MARKER_PATH || path.join(process.cwd(), ".sisyphus", "vfs-last-temp-dir.txt");
    try {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, `${label}: ${dirPath}\n`, "utf8");
    } catch {
      // ignore marker write failures in tests
    }
  }
}

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xnl-vfs-localfs-"));
}

function rmTmpDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function parseRootDataNode(filePath: string): DataElementNode {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = parseXnl(raw);
  const root = doc.nodes.find((node) => {
    return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement");
  });
  if (!root || typeof root !== "object") {
    throw new Error(`No data root in sidecar: ${filePath}`);
  }
  return root as DataElementNode;
}

describe("local-fs vfs persistence", () => {
  it("roundtrips sidecars and preserves metadata.id/extend", () => {
    const workspace = mkTmpDir();
    logTempDir("roundtrip workspace", workspace);
    try {
      const persistence = new LocalFsVfsPersistence({ workspaceRootPath: workspace });
      const vfs = new VirtualFileSystem(undefined, {
        reservedNames: persistence.getReservedNames(),
      });

      vfs.mkdir("vfs:///src", { recursive: true });
      vfs.writeFile("vfs:///src/main.ts", "export const answer = 42;", {
        fileType: "text",
        metadataId: "file_main",
        extend: {
          order: ["ViewExt"],
          children: {
            ViewExt: { kind: "DataElement", tag: "ViewExt", metadata: { color: "green" } },
          },
        },
      });

      const srcId = vfs.stat("vfs:///src").metadataId;
      persistence.saveFromVfs(vfs);

      const srcSidecar = path.join(workspace, ".node-meta", "src.node.xnl");
      const fileSidecar = path.join(workspace, "src", ".node-meta", "main.ts.node.xnl");
      expect(fs.existsSync(srcSidecar)).toBe(true);
      expect(fs.existsSync(fileSidecar)).toBe(true);

      const srcNode = parseRootDataNode(srcSidecar);
      const fileNode = parseRootDataNode(fileSidecar);
      expect(srcNode.tag).toBe("Folder");
      expect(fileNode.tag).toBe("File");
      expect(srcNode.body ?? []).toHaveLength(0);
      expect(fileNode.body ?? []).toHaveLength(0);

      const loaded = persistence.loadSnapshot();
      expect(loaded.warnings).toEqual([]);
      expect(loaded.dirty).toBe(false);

      const restored = new VirtualFileSystem(loaded.snapshot, {
        reservedNames: persistence.getReservedNames(),
      });
      expect(restored.stat("vfs:///src").metadataId).toBe(srcId);
      expect(restored.stat("vfs:///src/main.ts").metadataId).toBe("file_main");

      const snapshot = restored.getSnapshot();
      const srcFolder = (snapshot.body ?? []).find((child) => {
        return Boolean(child && typeof child === "object" && (child as DataElementNode).kind === "DataElement" && (child as DataElementNode).metadata?.name === "src");
      }) as DataElementNode | undefined;
      const mainFile = (srcFolder?.body ?? []).find((child) => {
        return Boolean(child && typeof child === "object" && (child as DataElementNode).kind === "DataElement" && (child as DataElementNode).metadata?.name === "main.ts");
      }) as DataElementNode | undefined;

      expect(mainFile).toBeTruthy();
      expect(mainFile?.extend).toBeTruthy();
      expect(readMetadataId(mainFile as DataElementNode)).toBe("file_main");
    } finally {
      if (!shouldKeepTempDir()) {
        rmTmpDir(workspace);
      }
    }
  });

  it("rejects reserved namespaces with ERESERVED", () => {
    const workspace = mkTmpDir();
    try {
      const persistence = new LocalFsVfsPersistence({ workspaceRootPath: workspace });
      const vfs = new VirtualFileSystem(undefined, {
        reservedNames: persistence.getReservedNames(),
      });

      expect(() => vfs.mkdir("vfs:///.node-meta", { recursive: false })).toThrowError(VfsError);
      expect(() => vfs.writeFile("vfs:///.xnl-vcs/HEAD.xnl", "x", { fileType: "text" })).toThrowError(VfsError);

      try {
        vfs.mkdir("vfs:///.node-meta", { recursive: false });
      } catch (error) {
        expect((error as VfsError).code).toBe("ERESERVED");
      }
    } finally {
      if (!shouldKeepTempDir()) {
        rmTmpDir(workspace);
      }
    }
  });

  it("stores sidecars in shadow tree when nodeMetaStorageRootPath is configured", () => {
    const workspace = mkTmpDir();
    const shadowMetaRoot = mkTmpDir();
    logTempDir("shadow workspace", workspace);
    logTempDir("shadow node-meta root", shadowMetaRoot);
    try {
      const persistence = new LocalFsVfsPersistence({
        workspaceRootPath: workspace,
        nodeMetaStorageRootPath: shadowMetaRoot,
      });
      const vfs = new VirtualFileSystem(undefined, {
        reservedNames: persistence.getReservedNames(),
      });

      vfs.mkdir("vfs:///src", { recursive: true });
      vfs.writeFile("vfs:///src/main.ts", "export const answer = 42;", {
        fileType: "text",
        metadataId: "file_main",
        extend: {
          order: ["ViewExt"],
          children: {
            ViewExt: { kind: "DataElement", tag: "ViewExt", metadata: { color: "green" } },
          },
        },
      });

      persistence.saveFromVfs(vfs);

      expect(fs.existsSync(path.join(workspace, ".node-meta"))).toBe(false);
      expect(fs.existsSync(path.join(workspace, "src", ".node-meta"))).toBe(false);
      expect(fs.existsSync(path.join(shadowMetaRoot, "root", "src.node.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(shadowMetaRoot, "tree", "src", "main.ts.node.xnl"))).toBe(true);

      const loaded = persistence.loadSnapshot();
      expect(loaded.warnings).toEqual([]);
      expect(loaded.dirty).toBe(false);

      const restored = new VirtualFileSystem(loaded.snapshot, {
        reservedNames: persistence.getReservedNames(),
      });
      expect(restored.stat("vfs:///src/main.ts").metadataId).toBe("file_main");
    } finally {
      if (!shouldKeepTempDir()) {
        rmTmpDir(workspace);
        rmTmpDir(shadowMetaRoot);
      }
    }
  });

  it("supports sparse sidecars without missing-sidecar warnings", () => {
    const workspace = mkTmpDir();
    logTempDir("sparse-sidecar workspace", workspace);
    try {
      const persistence = new LocalFsVfsPersistence({
        workspaceRootPath: workspace,
        skipSidecarWhenNoExtensionMetadata: true,
      });
      const vfs = new VirtualFileSystem(undefined, {
        reservedNames: persistence.getReservedNames(),
      });

      vfs.mkdir("vfs:///src", { recursive: true });
      vfs.writeFile("vfs:///src/plain.txt", "plain", {
        fileType: "text",
        metadataId: "plain_file",
      });
      vfs.writeFile("vfs:///src/ext.txt", "ext", {
        fileType: "text",
        metadataId: "ext_file",
        extend: {
          order: ["ViewExt"],
          children: {
            ViewExt: { kind: "DataElement", tag: "ViewExt", metadata: { color: "green" } },
          },
        },
      });

      persistence.saveFromVfs(vfs);

      expect(fs.existsSync(path.join(workspace, ".node-meta", "src.node.xnl"))).toBe(false);
      expect(fs.existsSync(path.join(workspace, "src", ".node-meta", "plain.txt.node.xnl"))).toBe(false);
      expect(fs.existsSync(path.join(workspace, "src", ".node-meta", "ext.txt.node.xnl"))).toBe(true);

      const loaded = persistence.loadSnapshot();
      expect(loaded.warnings).toEqual([]);
      expect(loaded.dirty).toBe(false);

      const restored = new VirtualFileSystem(loaded.snapshot, {
        reservedNames: persistence.getReservedNames(),
      });
      expect(restored.stat("vfs:///src/ext.txt").metadataId).toBe("ext_file");

      const snapshot = restored.getSnapshot();
      const srcFolder = (snapshot.body ?? []).find((child) => {
        return Boolean(child && typeof child === "object" && (child as DataElementNode).kind === "DataElement" && (child as DataElementNode).metadata?.name === "src");
      }) as DataElementNode | undefined;
      const extFile = (srcFolder?.body ?? []).find((child) => {
        return Boolean(child && typeof child === "object" && (child as DataElementNode).kind === "DataElement" && (child as DataElementNode).metadata?.name === "ext.txt");
      }) as DataElementNode | undefined;
      expect(extFile?.extend).toBeTruthy();
    } finally {
      if (!shouldKeepTempDir()) {
        rmTmpDir(workspace);
      }
    }
  });

  it("avoids root sidecar path collision with business 'root' directory in shadow storage", () => {
    const workspace = mkTmpDir();
    const shadowMetaRoot = mkTmpDir();
    logTempDir("shadow-collision workspace", workspace);
    logTempDir("shadow-collision node-meta root", shadowMetaRoot);
    try {
      const persistence = new LocalFsVfsPersistence({
        workspaceRootPath: workspace,
        nodeMetaStorageRootPath: shadowMetaRoot,
      });
      const vfs = new VirtualFileSystem(undefined, {
        reservedNames: persistence.getReservedNames(),
      });

      vfs.mkdir("vfs:///root", { recursive: true });
      vfs.writeFile("vfs:///root/leaf.txt", "leaf", {
        fileType: "text",
        metadataId: "root_leaf",
      });
      vfs.writeFile("vfs:///top.txt", "top", {
        fileType: "text",
        metadataId: "top_file",
      });

      persistence.saveFromVfs(vfs);

      expect(fs.existsSync(path.join(shadowMetaRoot, "root", "root.node.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(shadowMetaRoot, "root", "top.txt.node.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(shadowMetaRoot, "tree", "root", "leaf.txt.node.xnl"))).toBe(true);

      const rootLevelDirEntries = fs.readdirSync(path.join(shadowMetaRoot, "root")).sort();
      expect(rootLevelDirEntries).toEqual(["root.node.xnl", "top.txt.node.xnl"]);

      const loaded = persistence.loadSnapshot();
      expect(loaded.warnings).toEqual([]);
      expect(loaded.dirty).toBe(false);

      const restored = new VirtualFileSystem(loaded.snapshot, {
        reservedNames: persistence.getReservedNames(),
      });
      expect(restored.stat("vfs:///top.txt").metadataId).toBe("top_file");
      expect(restored.stat("vfs:///root/leaf.txt").metadataId).toBe("root_leaf");
    } finally {
      if (!shouldKeepTempDir()) {
        rmTmpDir(workspace);
        rmTmpDir(shadowMetaRoot);
      }
    }
  });

  it("updates workspace reserved names based on configured storage roots", () => {
    const tempDirs: string[] = [];
    const tmp = () => {
      const dir = mkTmpDir();
      tempDirs.push(dir);
      return dir;
    };

    try {
      const defaultPersistence = new LocalFsVfsPersistence({ workspaceRootPath: tmp() });
      expect(defaultPersistence.getReservedNames().sort()).toEqual([".node-meta", ".xnl-vcs"]);

      const shadowNodeMetaPersistence = new LocalFsVfsPersistence({
        workspaceRootPath: tmp(),
        nodeMetaStorageRootPath: tmp(),
      });
      expect(shadowNodeMetaPersistence.getReservedNames()).toEqual([".xnl-vcs"]);

      const shadowVcsPersistence = new LocalFsVfsPersistence({
        workspaceRootPath: tmp(),
        vcsStorageRootPath: tmp(),
      });
      expect(shadowVcsPersistence.getReservedNames()).toEqual([".node-meta"]);

      const bothShadowPersistence = new LocalFsVfsPersistence({
        workspaceRootPath: tmp(),
        nodeMetaStorageRootPath: tmp(),
        vcsStorageRootPath: tmp(),
      });
      expect(bothShadowPersistence.getReservedNames()).toEqual([]);
    } finally {
      if (!shouldKeepTempDir()) {
        for (const dir of tempDirs) {
          rmTmpDir(dir);
        }
      }
    }
  });

  it("handles missing and orphan sidecars as recoverable and rewrites sidecars", () => {
    const workspace = mkTmpDir();
    logTempDir("recoverable workspace", workspace);
    try {
      fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
      fs.writeFileSync(path.join(workspace, "src", "a.txt"), "A", "utf8");
      fs.mkdirSync(path.join(workspace, "src", ".node-meta"), { recursive: true });
      fs.writeFileSync(path.join(workspace, "src", ".node-meta", "ghost.node.xnl"), "<File { id=\"ghost\" name=\"ghost\" }>", "utf8");

      const persistence = new LocalFsVfsPersistence({ workspaceRootPath: workspace });
      const result = persistence.loadSnapshot();

      expect(result.dirty).toBe(true);
      expect(result.warnings.some((w) => w.includes("Missing sidecar"))).toBe(true);
      expect(result.warnings.some((w) => w.includes("Orphan sidecar"))).toBe(true);

      expect(fs.existsSync(path.join(workspace, ".node-meta", "src.node.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(workspace, "src", ".node-meta", "a.txt.node.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(workspace, "src", ".node-meta", "ghost.node.xnl"))).toBe(false);
    } finally {
      if (!shouldKeepTempDir()) {
        rmTmpDir(workspace);
      }
    }
  });
});
