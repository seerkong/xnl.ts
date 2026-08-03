import type { DataElementNode } from "xnl-core";
import {
  VFS_ROOT,
  VirtualFileSystem,
  createFileNode,
  createFolderNode,
  folderChildren,
  normalizeVfsPath,
  readFileContent,
  readFileType,
  readMetadataId,
  readName,
} from "xnl-vfs";
import { VcsError } from "./errors";
import type { ObjectId } from "./hash";
import { decodeLosslessVfsSnapshot, encodeLosslessVfsSnapshot } from "./lossless-ast-codec";
import { assertObject, type ObjectStore } from "./object-store";
import type { ContentStore } from "./content-store";
import type { BlobObject, FileSnapshot, TreeEntry, TreeObject, VcsObject } from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isDataElementNode(value: unknown): value is DataElementNode {
  return Boolean(value && typeof value === "object" && (value as DataElementNode).kind === "DataElement");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidVfsSnapshotRoot(value: unknown): value is DataElementNode {
  return isDataElementNode(value) && value.tag === "folder" && typeof value.tag === "string" && isRecord(value.metadata);
}

function isVfsIndexNode(value: unknown): value is DataElementNode {
  return isDataElementNode(value) && (value.tag === "folder" || value.tag === "file");
}

function businessFieldsWithoutReserved(node: DataElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node.metadata ?? {})) {
    if (key === "id" || key === "name" || key === "refId" || key === "nodeType" || key === "fileType") {
      continue;
    }
    out[key] = clone(value);
  }

  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (key === "id" || key === "name" || key === "refId" || key === "nodeType" || key === "fileType" || key === "content") {
      continue;
    }
    out[key] = clone(value);
  }

  return out;
}

function applyBusinessFields(node: DataElementNode, fields?: Record<string, unknown>): void {
  if (!fields) {
    return;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (key === "id" || key === "name" || key === "refId" || key === "nodeType" || key === "fileType" || key === "content") {
      continue;
    }
    node.attributes = {
      ...(node.attributes ?? {}),
      [key]: clone(value) as never,
    };
  }
}

function assertKind<T extends VcsObject["type"]>(obj: VcsObject, type: T): asserts obj is Extract<VcsObject, { type: T }> {
  if (obj.type !== type) {
    throw new VcsError("EINVAL", `Expected ${type} object, got ${obj.type}`);
  }
}

function writeNode(store: ObjectStore, contentStore: ContentStore, node: DataElementNode): ObjectId {
  if (node.tag === "file") {
    const fileType = readFileType(node);
    const content = readFileContent(node);
    const contentRef = contentStore.put(content, fileType);
    const record = contentStore.getRecord(contentRef);
    const blob: BlobObject = {
      type: "blob",
      fileType,
      contentRef,
      contentType: fileType,
      contentHash: record?.contentHash ?? contentRef,
      size: record?.sizeBytes ?? 0,
    };
    return store.put(blob);
  }

  if (node.tag !== "folder") {
    throw new VcsError("EINVAL", `Unknown node tag in tree conversion: ${node.tag}`);
  }

  const entries: TreeEntry[] = [];
  for (const child of folderChildren(node)) {
    const objectId = writeNode(store, contentStore, child);
    entries.push({
      name: readName(child),
      kind: child.tag === "folder" ? "folder" : "file",
      objectId,
      metadataId: readMetadataId(child),
      fileType: child.tag === "file" ? readFileType(child) : undefined,
      metadata: businessFieldsWithoutReserved(child),
      extend: child.extend,
    });
  }

  const extraMeta = businessFieldsWithoutReserved(node);
  const tree: TreeObject = {
    type: "tree",
    name: readName(node),
    metadataId: readMetadataId(node),
    extend: node.extend,
    metadata: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
    entries,
  };

  return store.put(tree);
}

function writeIndexNode(store: ObjectStore, contentStore: ContentStore, node: DataElementNode): ObjectId {
  if (node.tag === "file") {
    return writeNode(store, contentStore, node);
  }

  if (node.tag !== "folder") {
    throw new VcsError("EINVAL", `Lossless tree root must be a VFS folder or file, got ${node.tag}`);
  }

  const entries: TreeEntry[] = [];
  for (const child of node.body ?? []) {
    if (!isVfsIndexNode(child)) {
      continue;
    }
    const objectId = writeIndexNode(store, contentStore, child);
    entries.push({
      name: readName(child),
      kind: child.tag === "folder" ? "folder" : "file",
      objectId,
      metadataId: readMetadataId(child),
      fileType: child.tag === "file" ? readFileType(child) : undefined,
      metadata: businessFieldsWithoutReserved(child),
      extend: child.extend,
    });
  }

  const extraMeta = businessFieldsWithoutReserved(node);
  const tree: TreeObject = {
    type: "tree",
    name: readName(node),
    metadataId: readMetadataId(node),
    extend: node.extend,
    metadata: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
    entries,
  };

  return store.put(tree);
}

function readTree(store: ObjectStore, treeId: ObjectId): TreeObject {
  const object = assertObject(store.get(treeId), treeId);
  assertKind(object, "tree");
  return object;
}

function readBlob(store: ObjectStore, blobId: ObjectId): BlobObject {
  const object = assertObject(store.get(blobId), blobId);
  assertKind(object, "blob");
  return object;
}

function buildLegacyNodeFromTree(store: ObjectStore, contentStore: ContentStore, treeId: ObjectId): DataElementNode {
  const tree = readTree(store, treeId);
  const folder = createFolderNode(tree.name, {
    id: tree.metadataId,
    extend: tree.extend,
  });
  applyBusinessFields(folder, tree.metadata);
  folder.body = [];

  for (const entry of tree.entries) {
    if (entry.kind === "folder") {
      const childFolder = buildNodeFromTree(store, contentStore, entry.objectId);
      childFolder.metadata.name = entry.name;
      childFolder.metadata.id = entry.metadataId;
      applyBusinessFields(childFolder, entry.metadata);
      childFolder.extend = entry.extend;
      folder.body.push(childFolder);
      continue;
    }

    const blob = readBlob(store, entry.objectId);
    const content = contentStore.get(blob.contentRef);
    if (content === null) {
      throw new VcsError("ENOENT_OBJECT", `Content not found: ${blob.contentRef}`);
    }
    const childFile = createFileNode(entry.name, content, blob.fileType, {
      id: entry.metadataId,
      extend: entry.extend,
    });
    applyBusinessFields(childFile, entry.metadata);
    folder.body.push(childFile);
  }

  return folder;
}

function decodeLosslessTree(tree: TreeObject): DataElementNode {
  if (tree.xnlVfsFormat === undefined) {
    throw new VcsError("EINVAL", "Lossless XNL VFS tree missing xnl-vfs-v2 format marker");
  }
  if (tree.xnlVfsFormat !== "xnl-vfs-v2") {
    throw new VcsError("EINVAL", `Unsupported XNL VFS tree format: ${String(tree.xnlVfsFormat)}`);
  }
  if (tree.xnlVfsSnapshot === undefined) {
    throw new VcsError("EINVAL", "xnl-vfs-v2 tree missing snapshot payload");
  }
  const snapshot = decodeLosslessVfsSnapshot(tree.xnlVfsSnapshot);
  if (!isValidVfsSnapshotRoot(snapshot)) {
    throw new VcsError("EINVAL", "xnl-vfs-v2 tree missing snapshot payload");
  }
  return clone(snapshot);
}

function buildNodeFromTree(store: ObjectStore, contentStore: ContentStore, treeId: ObjectId): DataElementNode {
  const tree = readTree(store, treeId);
  if ("xnlVfsFormat" in tree && tree.xnlVfsFormat !== undefined) {
    return decodeLosslessTree(tree);
  }

  return buildLegacyNodeFromTree(store, contentStore, treeId);
}

function flattenNode(node: DataElementNode, basePath: string, files: FileSnapshot[]): void {
  if (node.tag === "file") {
    files.push({
      path: normalizeVfsPath(basePath),
      metadataId: readMetadataId(node),
      fileType: readFileType(node),
      content: readFileContent(node),
      metadata: businessFieldsWithoutReserved(node),
      extend: node.extend,
    });
    return;
  }

  if (node.tag !== "folder") {
    return;
  }

  for (const child of folderChildren(node)) {
    const childPath = normalizeVfsPath(`${basePath}/${readName(child)}`);
    flattenNode(child, childPath, files);
  }
}

export function buildTree(vfs: VirtualFileSystem, store: ObjectStore, contentStore: ContentStore): ObjectId {
  const snapshot = vfs.getSnapshot();
  return writeNode(store, contentStore, snapshot);
}

export function buildLosslessTree(snapshot: DataElementNode, store: ObjectStore, contentStore: ContentStore): ObjectId {
  if (!isValidVfsSnapshotRoot(snapshot)) {
    throw new VcsError("EINVAL", "Lossless tree root must be a VFS folder snapshot");
  }
  const payload = encodeLosslessVfsSnapshot(snapshot);
  const legacyTreeId = writeIndexNode(store, contentStore, snapshot);
  const legacyTree = readTree(store, legacyTreeId);
  const tree: TreeObject = {
    ...legacyTree,
    xnlVfsFormat: "xnl-vfs-v2",
    xnlVfsSnapshot: payload,
  };
  return store.put(tree);
}

export function checkoutTree(treeId: ObjectId, vfs: VirtualFileSystem, store: ObjectStore, contentStore: ContentStore): DataElementNode {
  const snapshot = readTreeSnapshot(treeId, store, contentStore);
  vfs.loadSnapshot(snapshot);
  return snapshot;
}

export function readTreeSnapshot(treeId: ObjectId, store: ObjectStore, contentStore: ContentStore): DataElementNode {
  return buildNodeFromTree(store, contentStore, treeId);
}

export function readLosslessTreeSnapshot(treeId: ObjectId, store: ObjectStore, _contentStore: ContentStore): DataElementNode {
  return decodeLosslessTree(readTree(store, treeId));
}

export function flattenSnapshot(snapshot: DataElementNode): FileSnapshot[] {
  const rootPath = VFS_ROOT;
  const files: FileSnapshot[] = [];
  flattenNode(snapshot, rootPath, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export function collectFolders(snapshot: DataElementNode): Map<string, { metadataId: string; extend?: unknown }> {
  const folders = new Map<string, { metadataId: string; extend?: unknown }>();

  const walk = (node: DataElementNode, currentPath: string) => {
    if (node.tag !== "folder") return;
    folders.set(normalizeVfsPath(currentPath), { metadataId: readMetadataId(node), extend: node.extend });
    for (const child of folderChildren(node)) {
      if (child.tag === "folder") {
        walk(child, `${currentPath}/${readName(child)}`);
      }
    }
  };

  walk(snapshot, VFS_ROOT);
  return folders;
}

export function flattenTree(treeId: ObjectId, store: ObjectStore, contentStore: ContentStore): FileSnapshot[] {
  const snapshot = readTreeSnapshot(treeId, store, contentStore);
  return flattenSnapshot(snapshot);
}
