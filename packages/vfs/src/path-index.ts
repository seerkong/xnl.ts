import type { DataElementNode } from "xnl-core";
import { VFS_ROOT, joinVfsPath } from "./path";
import { folderChildren, isFolder, readMetadataId, readName } from "./model";

export class VfsPathIndex {
  private readonly pathToId = new Map<string, string>();
  private readonly idToPath = new Map<string, string>();

  rebuild(root: DataElementNode): void {
    this.pathToId.clear();
    this.idToPath.clear();
    this.walk(root, VFS_ROOT);
  }

  resolveId(path: string): string | undefined {
    return this.pathToId.get(path);
  }

  resolvePath(id: string): string | undefined {
    return this.idToPath.get(id);
  }

  entries(): Array<{ path: string; id: string }> {
    return [...this.pathToId.entries()].map(([path, id]) => ({ path, id }));
  }

  private walk(node: DataElementNode, path: string): void {
    const id = readMetadataId(node);
    this.pathToId.set(path, id);
    this.idToPath.set(id, path);
    if (!isFolder(node)) {
      return;
    }
    for (const child of folderChildren(node)) {
      const name = readName(child);
      this.walk(child, joinVfsPath(path, name));
    }
  }
}
