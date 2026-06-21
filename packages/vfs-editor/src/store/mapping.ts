// VfsNode (component model) <-> xnl-vfs DataElementNode mapping.
//
// xnl-vfs is the single source of truth (R1). The component speaks a flat
// VfsNode[] with '/a/b' paths; xnl-vfs speaks a DataElementNode tree with
// 'vfs:///a/b' paths. App-level fields (sourceType/sourceConfig/cached/sortOrder)
// that must survive a vcs commit/checkout round-trip live in `metadata` (vcs
// preserves TreeEntry.metadata); static file text lives in `attributes.content`.
// XNL business content is never polluted with editor concerns.

import type { DataElementNode } from "xnl-core";
import {
  VFS_ROOT,
  joinVfsPath,
  isFolder,
  readMetadataId,
  readName,
  readFileContent,
  folderChildren,
} from "xnl-vfs";
import type {
  VfsNode,
  VfsSourceType,
  VfsSourceConfig,
} from "../types";

/** Metadata key under which editor-level fields are stashed (vcs-preserved). */
const APP_META_KEY = "vfsEditorMeta";

interface AppMeta {
  sourceType?: VfsSourceType;
  sourceConfig?: VfsSourceConfig;
  cached?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

function readAppMeta(node: DataElementNode): AppMeta {
  const raw = node.metadata?.[APP_META_KEY];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as AppMeta;
    } catch {
      return {};
    }
  }
  return {};
}

/** Serialize editor-level fields into a metadata string blob. */
export function encodeAppMeta(meta: AppMeta): string {
  return JSON.stringify(meta);
}

/** Component path ('/a/b') -> vfs path ('vfs:///a/b'). Root -> VFS_ROOT. */
export function toVfsPath(componentPath: string): string {
  const segments = componentPath.split("/").filter(Boolean);
  return joinVfsPath(VFS_ROOT, ...segments);
}

/** vfs path ('vfs:///a/b') -> component path ('/a/b'). */
export function toComponentPath(vfsPath: string): string {
  const rest = vfsPath.startsWith(VFS_ROOT)
    ? vfsPath.slice(VFS_ROOT.length)
    : vfsPath.replace(/^vfs:\/+/, "");
  const trimmed = rest.replace(/^\/+/, "");
  return "/" + trimmed;
}

/**
 * Flatten a vfs snapshot into the controlled component's VfsNode[] model.
 * The snapshot root (VFS_PROJECT folder) is the container — its children are
 * the top-level nodes (parentId = null).
 */
export function flattenSnapshot(snapshot: DataElementNode, treeId: string): VfsNode[] {
  const out: VfsNode[] = [];

  const walk = (node: DataElementNode, parentComponentPath: string, parentId: string | null) => {
    const name = readName(node);
    const id = readMetadataId(node);
    const componentPath = parentComponentPath === "/" ? `/${name}` : `${parentComponentPath}/${name}`;
    const meta = readAppMeta(node);
    const isDir = isFolder(node);

    const vfsNode: VfsNode = {
      id,
      treeId,
      name,
      path: componentPath,
      parentId,
      type: isDir ? "directory" : "file",
      sourceType: isDir ? undefined : meta.sourceType ?? "static",
      sourceConfig: isDir
        ? undefined
        : meta.sourceConfig ?? { content: readFileContent(node) },
      cached: meta.cached,
      sortOrder: meta.sortOrder ?? 0,
      metadata: undefined,
      createdAt: meta.createdAt ?? "",
      updatedAt: meta.updatedAt ?? "",
    };
    out.push(vfsNode);

    if (isDir) {
      for (const child of folderChildren(node)) {
        walk(child, componentPath, id);
      }
    }
  };

  // Root container: descend into its children as the top level.
  if (isFolder(snapshot)) {
    for (const child of folderChildren(snapshot)) {
      walk(child, "/", null);
    }
  }
  return out;
}

/** Extract the static-string content from a VfsNode (files only). */
export function nodeContent(node: Pick<VfsNode, "sourceType" | "sourceConfig">): string {
  if (node.sourceType === "static" && node.sourceConfig && "content" in node.sourceConfig) {
    return (node.sourceConfig as { content: string }).content ?? "";
  }
  return "";
}

export { APP_META_KEY };
export type { AppMeta };
