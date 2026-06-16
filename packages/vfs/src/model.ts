import type { DataElementNode, ExtendBody, XnlNode } from "xnl-core";
import { makeId } from "xnl-collab-core";
import { VfsError } from "./errors";
import type { VfsFileType } from "./types";

export type VfsFolderNode = DataElementNode;
export type VfsFileNode = DataElementNode;

export function cloneNode<T extends XnlNode>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stringField(node: DataElementNode, key: string): string | undefined {
  const raw = node.metadata?.[key];
  return typeof raw === "string" ? raw : undefined;
}

export function readMetadataId(node: DataElementNode): string {
  const id = stringField(node, "id");
  if (!id) {
    throw new VfsError("EINVAL", `Node is missing metadata.id for <${node.tag}>`);
  }
  return id;
}

export function readName(node: DataElementNode): string {
  const name = stringField(node, "name");
  if (!name) {
    throw new VfsError("EINVAL", `Node is missing metadata.name for <${node.tag}>`);
  }
  return name;
}

export function readFileType(node: DataElementNode): VfsFileType {
  // Canonical: attributes.fileType; fallback: metadata.fileType (legacy)
  const attrValue = typeof node.attributes?.fileType === "string" ? node.attributes.fileType : undefined;
  const value = attrValue ?? stringField(node, "fileType");
  if (value === "xnl" || value === "text" || value === "binary") {
    return value;
  }
  return "text";
}

export function readNodeType(node: DataElementNode): "folder" | "file" | undefined {
  // Canonical: attributes.nodeType; fallback: metadata.nodeType (legacy)
  const attrValue = typeof node.attributes?.nodeType === "string" ? node.attributes.nodeType : undefined;
  const value = attrValue ?? stringField(node, "nodeType");
  if (value === "folder" || value === "file") {
    return value;
  }
  return undefined;
}

export function isFolder(node: XnlNode): node is VfsFolderNode {
  return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement" && (node as DataElementNode).tag === "folder");
}

export function isFile(node: XnlNode): node is VfsFileNode {
  return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement" && (node as DataElementNode).tag === "file");
}

export function folderChildren(folder: VfsFolderNode): DataElementNode[] {
  const body = folder.body ?? [];
  return body.filter((item): item is DataElementNode => {
    return Boolean(item && typeof item === "object" && (item as DataElementNode).kind === "DataElement");
  });
}

function baseMetadata(name: string, nodeType: "folder" | "file", id?: string): { metadata: Record<string, XnlNode>; attributes: Record<string, XnlNode> } {
  return {
    metadata: {
      id: id ?? makeId(`${nodeType}_`),
      name,
    },
    attributes: {
      nodeType,
    },
  };
}

export function createFolderNode(name: string, options?: { id?: string; extend?: ExtendBody }): VfsFolderNode {
  const base = baseMetadata(name, "folder", options?.id);
  const node: VfsFolderNode = {
    kind: "DataElement",
    tag: "folder",
    metadata: base.metadata,
    attributes: base.attributes,
    body: [],
  };
  if (options?.extend) {
    node.extend = options.extend;
  }
  return node;
}

export function createFileNode(name: string, content: string, fileType: VfsFileType, options?: { id?: string; extend?: ExtendBody }): VfsFileNode {
  const base = baseMetadata(name, "file", options?.id);
  const node: VfsFileNode = {
    kind: "DataElement",
    tag: "file",
    metadata: base.metadata,
    attributes: {
      ...base.attributes,
      fileType,
      content,
    },
  };
  if (options?.extend) {
    node.extend = options.extend;
  }
  return node;
}

export function readFileContent(node: VfsFileNode): string {
  const content = node.attributes?.content;
  return typeof content === "string" ? content : "";
}

export function setFileContent(node: VfsFileNode, content: string): void {
  if (!node.attributes || typeof node.attributes !== "object") {
    node.attributes = {};
  }
  node.attributes.content = content;
}

export function deepCloneWithNewIds(node: DataElementNode): DataElementNode {
  const cloned = cloneNode(node);
  const visit = (current: DataElementNode) => {
    current.metadata = {
      ...(current.metadata ?? {}),
      id: makeId("copy_"),
    };
    const body = current.body ?? [];
    for (const child of body) {
      if (child && typeof child === "object" && (child as DataElementNode).kind === "DataElement") {
        visit(child as DataElementNode);
      }
    }
  };
  visit(cloned);
  return cloned;
}
