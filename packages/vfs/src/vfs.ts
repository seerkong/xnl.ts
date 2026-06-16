import type { DataElementNode, ExtendBody } from "xnl-core";
import { VfsError, assertVfs } from "./errors";
import { createFileNode, createFolderNode, deepCloneWithNewIds, folderChildren, isFile, isFolder, readFileContent, readFileType, readMetadataId, readName, setFileContent } from "./model";
import { VfsPathIndex } from "./path-index";
import { VFS_PROJECT, VFS_ROOT, assertNotRoot, basenameVfsPath, dirnameVfsPath, normalizeVfsPath, toSegments } from "./path";
import type { CopyOptions, MkdirOptions, RenameOptions, RmdirOptions, VfsEntry, VfsFileType, VfsStat, VirtualFileSystemOptions, WriteFileOptions } from "./types";

type ParentLookup = {
  parent: DataElementNode;
  name: string;
  path: string;
};

export class VirtualFileSystem {
  private root: DataElementNode;
  private readonly index = new VfsPathIndex();
  private readonly reservedNames: Set<string>;

  constructor(seed?: DataElementNode, options: VirtualFileSystemOptions = {}) {
    this.root = seed ? (JSON.parse(JSON.stringify(seed)) as DataElementNode) : createFolderNode(VFS_PROJECT);
    this.reservedNames = new Set(options.reservedNames ?? []);
    this.rebuildIndex();
  }

  getSnapshot(): DataElementNode {
    return JSON.parse(JSON.stringify(this.root)) as DataElementNode;
  }

  loadSnapshot(snapshot: DataElementNode): void {
    this.root = JSON.parse(JSON.stringify(snapshot)) as DataElementNode;
    this.rebuildIndex();
  }

  getPathIndex(): VfsPathIndex {
    return this.index;
  }

  exists(path: string): boolean {
    try {
      this.getNode(path);
      return true;
    } catch {
      return false;
    }
  }

  stat(path: string): VfsStat {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const node = this.getNode(normalized);
    if (isFolder(node)) {
      return {
        kind: "folder",
        path: normalized,
        name: readName(node),
        metadataId: readMetadataId(node),
      };
    }
    if (isFile(node)) {
      return {
        kind: "file",
        path: normalized,
        name: readName(node),
        metadataId: readMetadataId(node),
        fileType: readFileType(node),
        size: readFileContent(node).length,
      };
    }
    throw new VfsError("EINVAL", `Unknown node kind at ${path}`);
  }

  readdir(path: string): VfsEntry[] {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const node = this.getNode(normalized);
    assertVfs(isFolder(node), "ENOTDIR", `Not a directory: ${normalized}`);
    return folderChildren(node)
      .map((child) => {
        const kind = isFolder(child) ? "folder" : "file";
        return {
          name: readName(child),
          path: normalizeVfsPath(`${normalized}/${readName(child)}`),
          kind,
          metadataId: readMetadataId(child),
          fileType: kind === "file" ? readFileType(child) : undefined,
        } as VfsEntry;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  mkdir(path: string, options: MkdirOptions = {}): void {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const segments = toSegments(normalized);
    let current = this.root;
    let currentPath = VFS_ROOT;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as string;
      const children = folderChildren(current);
      const existing = children.find((child) => readName(child) === segment);

      if (existing) {
        assertVfs(isFolder(existing), "ENOTDIR", `Path segment is not a folder: ${segment}`);
        current = existing;
        currentPath = normalizeVfsPath(`${currentPath}/${segment}`);
        continue;
      }

      const isLeaf = i === segments.length - 1;
      if (!options.recursive && !isLeaf) {
        throw new VfsError("ENOENT", `Missing parent folder for ${normalized}`);
      }

      const folder = createFolderNode(segment);
      if (!current.body) {
        current.body = [];
      }
      current.body.push(folder);
      current = folder;
      currentPath = normalizeVfsPath(`${currentPath}/${segment}`);
    }

    this.rebuildIndex();
  }

  writeFile(path: string, content: string, options: WriteFileOptions = {}): void {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const parentLookup = this.getParentLookup(normalized);
    const parent = parentLookup.parent;
    const name = parentLookup.name;

    const existing = this.findChild(parent, name);
    const fileType = options.fileType ?? "text";

    if (existing) {
      assertVfs(isFile(existing), "EISDIR", `Cannot write file over directory: ${normalized}`);
      if (options.overwrite === false) {
        throw new VfsError("EEXIST", `File already exists: ${normalized}`);
      }
      setFileContent(existing, content);
      existing.attributes = {
        ...(existing.attributes ?? {}),
        fileType,
      };
      if (existing.metadata && "fileType" in existing.metadata) {
        delete existing.metadata.fileType;
      }
      if (options.extend) {
        existing.extend = options.extend;
      }
    } else {
      if (!parent.body) {
        parent.body = [];
      }
      parent.body.push(createFileNode(name, content, fileType, { id: options.metadataId, extend: options.extend }));
    }

    this.rebuildIndex();
  }

  readFile(path: string): string {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const node = this.getNode(normalized);
    assertVfs(isFile(node), "EISDIR", `Path is a directory: ${normalized}`);
    return readFileContent(node);
  }

  readFileType(path: string): VfsFileType {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const node = this.getNode(normalized);
    assertVfs(isFile(node), "EISDIR", `Path is a directory: ${path}`);
    return readFileType(node);
  }

  rename(from: string, to: string, options: RenameOptions = {}): void {
    const fromPath = normalizeVfsPath(from);
    const toPath = normalizeVfsPath(to);
    this.assertManagedPath(fromPath);
    this.assertManagedPath(toPath);
    assertNotRoot(fromPath);

    const fromLookup = this.getParentLookup(fromPath);
    const source = this.findChild(fromLookup.parent, fromLookup.name);
    if (!source) {
      throw new VfsError("ENOENT", `Source does not exist: ${fromPath}`);
    }

    const toLookup = this.getParentLookup(toPath);
    const destination = this.findChild(toLookup.parent, toLookup.name);
    if (destination) {
      if (!options.overwrite) {
        throw new VfsError("EEXIST", `Destination exists: ${toPath}`);
      }
      if (isFolder(destination) && folderChildren(destination).length > 0) {
        throw new VfsError("ENOTEMPTY", `Cannot overwrite non-empty destination folder: ${toPath}`);
      }
      this.removeChild(toLookup.parent, toLookup.name);
    }

    this.removeChild(fromLookup.parent, fromLookup.name);
    source.metadata.name = toLookup.name;
    if (!toLookup.parent.body) {
      toLookup.parent.body = [];
    }
    toLookup.parent.body.push(source);
    this.rebuildIndex();
  }

  copy(from: string, to: string, options: CopyOptions = {}): void {
    const fromPath = normalizeVfsPath(from);
    const toPath = normalizeVfsPath(to);
    this.assertManagedPath(fromPath);
    this.assertManagedPath(toPath);
    const source = this.getNode(fromPath);
    const toLookup = this.getParentLookup(toPath);
    const existing = this.findChild(toLookup.parent, toLookup.name);

    if (existing && !options.overwrite) {
      throw new VfsError("EEXIST", `Destination exists: ${toPath}`);
    }
    if (existing) {
      this.removeChild(toLookup.parent, toLookup.name);
    }

    const cloned = deepCloneWithNewIds(source);
    cloned.metadata.name = toLookup.name;
    if (!toLookup.parent.body) {
      toLookup.parent.body = [];
    }
    toLookup.parent.body.push(cloned);
    this.rebuildIndex();
  }

  unlink(path: string): void {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    assertNotRoot(normalized);
    const lookup = this.getParentLookup(normalized);
    const node = this.findChild(lookup.parent, lookup.name);
    if (!node) {
      throw new VfsError("ENOENT", `File does not exist: ${normalized}`);
    }
    assertVfs(isFile(node), "EISDIR", `Cannot unlink directory: ${normalized}`);
    this.removeChild(lookup.parent, lookup.name);
    this.rebuildIndex();
  }

  rmdir(path: string, options: RmdirOptions = {}): void {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    assertNotRoot(normalized);
    const lookup = this.getParentLookup(normalized);
    const node = this.findChild(lookup.parent, lookup.name);
    if (!node) {
      throw new VfsError("ENOENT", `Folder does not exist: ${normalized}`);
    }
    assertVfs(isFolder(node), "ENOTDIR", `Not a folder: ${normalized}`);

    if (!options.recursive && folderChildren(node).length > 0) {
      throw new VfsError("ENOTEMPTY", `Folder is not empty: ${normalized}`);
    }

    this.removeChild(lookup.parent, lookup.name);
    this.rebuildIndex();
  }

  getExtend(path: string): ExtendBody | undefined {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const node = this.getNode(normalized);
    return node.extend;
  }

  private rebuildIndex(): void {
    this.index.rebuild(this.root);
  }

  private getNode(path: string): DataElementNode {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    if (normalized === VFS_ROOT) {
      return this.root;
    }
    const segments = toSegments(normalized);
    let current = this.root;
    for (const segment of segments) {
      const next = this.findChild(current, segment);
      if (!next) {
        throw new VfsError("ENOENT", `Path does not exist: ${normalized}`);
      }
      current = next;
    }
    return current;
  }

  private getParentLookup(path: string): ParentLookup {
    const normalized = normalizeVfsPath(path);
    this.assertManagedPath(normalized);
    const parentPath = dirnameVfsPath(normalized);
    const name = basenameVfsPath(normalized);
    const parent = this.getNode(parentPath);
    assertVfs(isFolder(parent), "ENOTDIR", `Parent is not a directory: ${parentPath}`);
    return { parent, name, path: normalized };
  }

  private findChild(parent: DataElementNode, name: string): DataElementNode | undefined {
    return folderChildren(parent).find((child) => readName(child) === name);
  }

  private removeChild(parent: DataElementNode, name: string): void {
    const body = parent.body ?? [];
    const index = body.findIndex((child) => {
      return Boolean(child && typeof child === "object" && (child as DataElementNode).kind === "DataElement" && readName(child as DataElementNode) === name);
    });
    if (index < 0) {
      throw new VfsError("ENOENT", `Child does not exist: ${name}`);
    }
    body.splice(index, 1);
    parent.body = body;
  }

  private assertManagedPath(normalizedPath: string): void {
    const segments = toSegments(normalizedPath);
    for (const segment of segments) {
      if (this.reservedNames.has(segment)) {
        throw new VfsError("ERESERVED", `Reserved namespace node is not allowed: ${normalizedPath}`);
      }
    }
  }
}
