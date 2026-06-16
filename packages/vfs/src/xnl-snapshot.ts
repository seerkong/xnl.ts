import { createHash } from "node:crypto";
import { XNL, parseXnl, type DataElementNode, type TextElementNode, type XnlNode } from "xnl-core";
import { VfsError } from "./errors";
import { createFileNode, createFolderNode, folderChildren, readFileContent, readFileType, readMetadataId, readName } from "./model";
import { VFS_ROOT } from "./path";
import type { VfsFileType } from "./types";

export type VfsSnapshotMode = "manifest" | "full";

export interface SerializeVfsSnapshotOptions {
  mode?: VfsSnapshotMode;
}

type ContentRecord = {
  id: string;
  hash: string;
  kind: VfsFileType;
  payload: string;
};

function cloneDataNode<T extends DataElementNode>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readMetadataString(node: DataElementNode, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function hashContent(kind: VfsFileType, payload: string): string {
  return createHash("sha256").update(`${kind}\u0000${payload}`).digest("hex");
}

function refIdFromHash(hash: string): string {
  return `c_${hash.slice(0, 12)}`;
}

function asVfsFileType(value: unknown): VfsFileType {
  return value === "xnl" || value === "binary" || value === "text" ? value : "text";
}

function ensureDataElement(node: XnlNode | undefined, tag?: string): DataElementNode {
  if (!node || typeof node !== "object" || (node as DataElementNode).kind !== "DataElement") {
    throw new VfsError("EINVAL", `Expected DataElement${tag ? ` <${tag}>` : ""}`);
  }
  const element = node as DataElementNode;
  if (tag && element.tag !== tag) {
    throw new VfsError("EINVAL", `Expected <${tag}> but got <${element.tag}>`);
  }
  return element;
}

function firstChildByTag(node: DataElementNode, tag: string): DataElementNode | undefined {
  for (const child of node.body ?? []) {
    if (typeof child === "object" && child !== null && (child as DataElementNode).kind === "DataElement" && (child as DataElementNode).tag === tag) {
      return child as DataElementNode;
    }
  }
  return undefined;
}

function asTextElement(node: XnlNode): TextElementNode | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  const value = node as TextElementNode;
  return value.kind === "TextElement" ? value : undefined;
}

function serializeFolderNode(folder: DataElementNode, contents: Map<string, ContentRecord>): DataElementNode {
  const entries = folderChildren(folder)
    .map((child) => {
      if (child.tag === "folder") {
        return serializeFolderNode(child, contents);
      }

      if (child.tag !== "file") {
        throw new VfsError("EINVAL", `Unsupported VFS node under folder: <${child.tag}>`);
      }

      const payload = readFileContent(child);
      const kind = readFileType(child);
      const hash = hashContent(kind, payload);
      const refId = refIdFromHash(hash);
      if (!contents.has(refId)) {
        contents.set(refId, { id: refId, hash, kind, payload });
      }

      const fileNode: DataElementNode = {
        kind: "DataElement",
        tag: "File",
        metadata: {
          id: readMetadataId(child),
          name: readName(child),
        },
        attributes: {
          fileType: kind,
        },
        body: [
          {
            kind: "DataElement",
            tag: "Content",
            metadata: {
              refId,
            },
            attributes: {
              hash: `sha256:${hash}`,
            },
          },
        ],
      };

      if (child.extend) {
        fileNode.extend = cloneDataNode(child).extend;
      }

      return fileNode;
    });

  const folderNode: DataElementNode = {
    kind: "DataElement",
    tag: "Folder",
    metadata: {
      id: readMetadataId(folder),
      name: readName(folder),
    },
    body: [
      {
        kind: "DataElement",
        tag: "Entries",
        metadata: {},
        body: entries,
      },
    ],
  };

  if (folder.extend) {
    folderNode.extend = cloneDataNode(folder).extend;
  }

  return folderNode;
}

function buildContentsNode(contents: Map<string, ContentRecord>): DataElementNode {
  const children: TextElementNode[] = [...contents.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      kind: "TextElement",
      tag: "Content",
      metadata: {
        id: entry.id,
        kind: entry.kind,
        encoding: entry.kind === "binary" ? "base64" : "utf8",
        hash: `sha256:${entry.hash}`,
      },
      text: entry.payload,
      textMarker: "",
    }));

  return {
    kind: "DataElement",
    tag: "Contents",
    metadata: {},
    body: children,
  };
}

export function serializeVfsSnapshot(snapshot: DataElementNode, options: SerializeVfsSnapshotOptions = {}): DataElementNode {
  if (snapshot.tag !== "folder") {
    throw new VfsError("EINVAL", "VFS snapshot root must be <folder>");
  }

  const mode = options.mode ?? "full";
  const contents = new Map<string, ContentRecord>();
  const treeRoot = serializeFolderNode(snapshot, contents);

  const body: XnlNode[] = [
    {
      kind: "DataElement",
      tag: "Tree",
      metadata: {},
      body: [treeRoot],
    },
  ];

  if (mode === "full") {
    body.push(buildContentsNode(contents));
  }

  return {
    kind: "DataElement",
    tag: "VfsSnapshot",
    metadata: {
      version: "2",
      root: VFS_ROOT,
      id: readMetadataId(snapshot),
      name: readName(snapshot),
    },
    body,
  };
}

export function serializeVfsSnapshotToString(snapshot: DataElementNode, options: SerializeVfsSnapshotOptions = {}): string {
  return XNL.stringify(serializeVfsSnapshot(snapshot, options), { pretty: true, indent: 2 });
}

function parseContents(snapshotNode: DataElementNode): Map<string, ContentRecord> {
  const contentsNode = firstChildByTag(snapshotNode, "Contents");
  const out = new Map<string, ContentRecord>();
  if (!contentsNode) {
    return out;
  }

  for (const child of contentsNode.body ?? []) {
    const textElement = asTextElement(child);
    if (!textElement || textElement.tag !== "Content") {
      continue;
    }

    const id = typeof textElement.metadata?.id === "string" ? textElement.metadata.id : undefined;
    if (!id) {
      continue;
    }

    const kind = asVfsFileType(textElement.metadata?.kind);
    const payload = typeof textElement.text === "string" ? textElement.text : "";
    const hashMeta = typeof textElement.metadata?.hash === "string" ? textElement.metadata.hash : undefined;
    const hash = hashMeta?.startsWith("sha256:") ? hashMeta.slice("sha256:".length) : hashContent(kind, payload);

    out.set(id, { id, hash, kind, payload });
  }

  return out;
}

function deserializeFolderNode(folderNode: DataElementNode, contents: Map<string, ContentRecord>): DataElementNode {
  const name = readMetadataString(folderNode, "name") ?? "";
  const id = readMetadataString(folderNode, "id");
  const folder = createFolderNode(name, { id, extend: folderNode.extend });
  if (!folderNode.extend) {
    delete folder.extend;
  }
  folder.body = [];

  const entriesNode = firstChildByTag(folderNode, "Entries");
  for (const entry of entriesNode?.body ?? []) {
    if (!entry || typeof entry !== "object" || (entry as DataElementNode).kind !== "DataElement") {
      continue;
    }

    const child = entry as DataElementNode;
    if (child.tag === "Folder") {
      folder.body.push(deserializeFolderNode(child, contents));
      continue;
    }

    if (child.tag !== "File") {
      continue;
    }

    const fileName = readMetadataString(child, "name") ?? "";
    const fileId = readMetadataString(child, "id");
    const fileType = asVfsFileType(
      typeof child.attributes?.fileType === "string" ? child.attributes.fileType : readMetadataString(child, "fileType"),
    );
    const refNode = firstChildByTag(child, "Content");
    const refId = refNode ? readMetadataString(refNode, "refId") : undefined;
    const payload = refId ? contents.get(refId)?.payload ?? "" : "";

    const file = createFileNode(fileName, payload, fileType, { id: fileId, extend: child.extend });
    if (!child.extend) {
      delete file.extend;
    }
    folder.body.push(file);
  }

  return folder;
}

export function deserializeVfsSnapshot(serialized: DataElementNode): DataElementNode {
  if (serialized.tag !== "VfsSnapshot") {
    throw new VfsError("EINVAL", `Expected <VfsSnapshot>, got <${serialized.tag}>`);
  }

  const treeNode = ensureDataElement(firstChildByTag(serialized, "Tree"), "Tree");
  const rootFolderNode = ensureDataElement((treeNode.body ?? [])[0], "Folder");
  const contents = parseContents(serialized);

  return deserializeFolderNode(rootFolderNode, contents);
}

export function deserializeVfsSnapshotFromString(input: string): DataElementNode {
  const document = parseXnl(input);
  const snapshotNode = document.nodes.find((node) => {
    return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement" && (node as DataElementNode).tag === "VfsSnapshot");
  });
  if (!snapshotNode || typeof snapshotNode !== "object") {
    throw new VfsError("EINVAL", "No <VfsSnapshot> node found in XNL document");
  }
  return deserializeVfsSnapshot(snapshotNode as DataElementNode);
}
