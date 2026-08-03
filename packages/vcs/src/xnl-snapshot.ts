import { XNL, parseXnl, type DataElementNode, type TextElementNode, type XnlNode } from "xnl-core";
import { type VfsFileType } from "xnl-vfs";
import { VcsError } from "./errors";
import { sha256Hex, type ObjectId } from "./hash";
import { decodeLosslessVfsSnapshot } from "./lossless-ast-codec";
import { MemoryObjectStore, type ObjectStore } from "./object-store";
import { MemoryContentStore, encodingForType, type ContentStore } from "./content-store";
import { Repository } from "./repository";
import type { BlobObject, CommitObject, ContentKey, TagObject, TreeEntry, TreeObject, VcsObject } from "./types";

export type RepositorySnapshotMode = "manifest" | "full";

export interface RepositoryStateSnapshot {
  head: { type: "branch"; name: string } | { type: "detached"; commitId: ObjectId };
  branches: Record<string, ObjectId | null>;
  tags: Record<string, ObjectId | null>;
  objects: Record<ObjectId, VcsObject>;
  /** Content payloads keyed by contentRef, separated from blob objects. */
  contents: Record<ContentKey, ContentSnapshotRecord>;
}

export interface SerializeRepositorySnapshotOptions {
  mode?: RepositorySnapshotMode;
}

type ContentSnapshotRecord = {
  contentKey: ContentKey;
  contentType: VfsFileType;
  encoding: "utf8" | "base64";
  payload: string;
  hash: string;
  size: number;
};

function asVfsFileType(value: unknown): VfsFileType {
  return value === "xnl" || value === "binary" || value === "text" ? value : "text";
}


function sortedObjectEntries<T>(value: Record<string, T>): Array<[string, T]> {
  return Object.entries(value).sort((a, b) => a[0].localeCompare(b[0]));
}

function sortedBody(node: DataElementNode): DataElementNode[] {
  const out: DataElementNode[] = [];
  for (const child of node.body ?? []) {
    if (typeof child === "object" && child !== null && (child as DataElementNode).kind === "DataElement") {
      out.push(child as DataElementNode);
    }
  }
  return out;
}

function firstChildByTag(node: DataElementNode, tag: string): DataElementNode | undefined {
  return sortedBody(node).find((child) => child.tag === tag);
}

function asTextElement(node: XnlNode): TextElementNode | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  const value = node as TextElementNode;
  return value.kind === "TextElement" ? value : undefined;
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

function ensureDataElement(node: XnlNode | undefined, expectedTag?: string): DataElementNode {
  if (!node || typeof node !== "object" || (node as DataElementNode).kind !== "DataElement") {
    throw new VcsError("EINVAL", `Expected DataElement${expectedTag ? ` <${expectedTag}>` : ""}`);
  }
  const value = node as DataElementNode;
  if (expectedTag && value.tag !== expectedTag) {
    throw new VcsError("EINVAL", `Expected <${expectedTag}> but got <${value.tag}>`);
  }
  return value;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function readStringMeta(node: DataElementNode, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function readStringAttr(node: DataElementNode, key: string): string | undefined {
  const value = node.attributes?.[key];
  return typeof value === "string" ? value : undefined;
}

function readStringAttrFirst(node: DataElementNode, key: string): string | undefined {
  return readStringAttr(node, key) ?? readStringMeta(node, key);
}

function readStringArrayAttrFirst(node: DataElementNode, key: string): string[] {
  if (node.attributes && key in node.attributes) {
    return parseStringArray(node.attributes[key]);
  }
  return parseStringArray(node.metadata?.[key]);
}

function readNullableRef(node: DataElementNode): ObjectId | null {
  const raw = node.attributes?.target ?? node.metadata?.target;
  return typeof raw === "string" ? raw : null;
}

function parseJsonAttribute(element: DataElementNode, key: string): unknown {
  const raw = readStringAttrFirst(element, key);
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new VcsError("EINVAL", `<${element.tag}> has malformed ${key}`);
  }
}

export function captureRepositorySnapshot(repository: Repository): RepositoryStateSnapshot {
  const objects: Record<ObjectId, VcsObject> = {};
  const contents: Record<ContentKey, ContentSnapshotRecord> = {};
  for (const id of repository.store.list()) {
    const object = repository.store.get(id);
    if (object) {
      objects[id] = JSON.parse(JSON.stringify(object)) as VcsObject;
      if (object.type === "blob" && !contents[object.contentRef]) {
        const record = repository.contentStore.getRecord(object.contentRef);
        if (record) {
          contents[object.contentRef] = {
            contentKey: record.contentKey,
            contentType: record.contentType,
            encoding: record.encoding,
            payload: record.contentText,
            hash: record.contentHash,
            size: record.sizeBytes,
          };
        }
      }
    }
  }

  const branches: Record<string, ObjectId | null> = {};
  for (const name of repository.listBranches()) {
    branches[name] = repository.getBranchHead(name);
  }

  const tags: Record<string, ObjectId | null> = {};
  for (const tagName of repository.listTags()) {
    const tagEntry = sortedObjectEntries(objects).find(([id, object]) => object.type === "tag" && object.name === tagName && id.length > 0);
    tags[tagName] = tagEntry?.[0] ?? null;
  }

  const headState = repository.getHead();
  const head =
    headState.type === "branch"
      ? { type: "branch" as const, name: headState.name }
      : { type: "detached" as const, commitId: headState.commitId };

  return {
    head,
    branches,
    tags,
    objects,
    contents,
  };
}

export function restoreRepositoryFromSnapshot(
  snapshot: RepositoryStateSnapshot,
  options?: { store?: ObjectStore; contentStore?: ContentStore }
): Repository {
  const store = options?.store ?? new MemoryObjectStore();
  const contentStore = options?.contentStore ?? new MemoryContentStore();

  for (const record of Object.values(snapshot.contents ?? {})) {
    const written = contentStore.put(record.payload, record.contentType);
    if (written !== record.contentKey) {
      throw new VcsError("EINVAL", `Snapshot content key mismatch: expected ${record.contentKey}, got ${written}`);
    }
  }

  for (const [id, object] of sortedObjectEntries(snapshot.objects)) {
    const written = store.put(object);
    if (written !== id) {
      throw new VcsError("EINVAL", `Snapshot object ID mismatch: expected ${id}, got ${written}`);
    }
  }

  return new Repository({
    store,
    contentStore,
    state: {
      head: snapshot.head,
      branches: snapshot.branches,
      tags: snapshot.tags,
    },
  });
}

function serializeBlobObject(id: ObjectId, object: BlobObject): DataElementNode {
  return {
    kind: "DataElement",
    tag: "Blob",
    metadata: {
      id,
      refId: object.contentRef,
    },
    attributes: {
      fileType: object.fileType,
      contentType: object.contentType,
      size: object.size,
      hash: `sha256:${object.contentHash}`,
    },
  };
}

function serializeTreeObject(id: ObjectId, object: TreeObject): DataElementNode {
  const attributes: DataElementNode["attributes"] = {
    metadataId: object.metadataId,
  };
  if (object.metadata !== undefined) {
    attributes.metadataJson = JSON.stringify(object.metadata);
  }
  if (object.xnlVfsFormat !== undefined) {
    if (object.xnlVfsFormat !== "xnl-vfs-v2" || object.xnlVfsSnapshot === undefined) {
      throw new VcsError("EINVAL", "Malformed xnl-vfs-v2 tree object");
    }
    const decoded = decodeLosslessVfsSnapshot(object.xnlVfsSnapshot);
    if (!isValidVfsSnapshotRoot(decoded)) {
      throw new VcsError("EINVAL", "Malformed xnl-vfs-v2 tree object");
    }
    attributes.xnlVfsFormat = object.xnlVfsFormat;
    attributes.xnlVfsSnapshotJson = JSON.stringify(object.xnlVfsSnapshot);
  }

  const entries: DataElementNode[] = object.entries.map((entry) => {
    const metadata: DataElementNode["metadata"] = {
      name: entry.name,
    };
    const attributes: DataElementNode["attributes"] = {
      kind: entry.kind === "folder" ? "tree" : "blob",
      oid: entry.objectId,
      metadataId: entry.metadataId,
      metadataJson: JSON.stringify(entry.metadata ?? {}),
    };
    if (entry.fileType) {
      attributes.fileType = entry.fileType;
    }
    return {
      kind: "DataElement",
      tag: "Entry",
      metadata,
      attributes,
      extend: entry.extend,
    };
  });

  return {
    kind: "DataElement",
    tag: "Tree",
    metadata: {
      id,
      name: object.name,
    },
    attributes,
    extend: object.extend,
    body: [
      {
        kind: "DataElement",
        tag: "Entries",
        metadata: {},
        body: entries,
      },
    ],
  };
}

function serializeCommitObject(id: ObjectId, object: CommitObject): DataElementNode {
  return {
    kind: "DataElement",
    tag: "Commit",
    metadata: {
      id,
    },
    attributes: {
      tree: object.tree,
      parents: [...object.parents],
      author: object.author,
      message: object.message,
      timestamp: object.timestamp,
    },
  };
}

function serializeTagObject(id: ObjectId, object: TagObject): DataElementNode {
  const metadata: DataElementNode["metadata"] = {
    id,
    name: object.name,
  };
  const attributes: DataElementNode["attributes"] = {
    target: object.target,
  };
  if (object.message !== undefined) {
    attributes.message = object.message;
  }
  return {
    kind: "DataElement",
    tag: "Tag",
    metadata,
    attributes,
  };
}

function buildContentsNode(contents: Record<ContentKey, ContentSnapshotRecord>): DataElementNode {
  const body: TextElementNode[] = Object.values(contents)
    .sort((a, b) => a.contentKey.localeCompare(b.contentKey))
    .map((entry) => ({
      kind: "TextElement",
      tag: "Content",
      metadata: {
        id: entry.contentKey,
        kind: entry.contentType,
        encoding: entry.encoding,
        hash: `sha256:${entry.hash}`,
        size: entry.size,
      },
      text: entry.payload,
      textMarker: "",
    }));

  return {
    kind: "DataElement",
    tag: "Contents",
    metadata: {},
    body,
  };
}

export function serializeRepositorySnapshot(snapshot: RepositoryStateSnapshot, options: SerializeRepositorySnapshotOptions = {}): DataElementNode {
  const mode = options.mode ?? "full";

  const refsBody: DataElementNode[] = [];
  for (const [name, target] of sortedObjectEntries(snapshot.branches)) {
    const fullName = `refs/heads/${name}`;
    refsBody.push({
      kind: "DataElement",
      tag: "Ref",
      metadata: {
        id: fullName,
        name: fullName,
      },
      attributes: {
        kind: "branch",
        target,
      },
    });
  }
  for (const [name, target] of sortedObjectEntries(snapshot.tags)) {
    const fullName = `refs/tags/${name}`;
    refsBody.push({
      kind: "DataElement",
      tag: "Ref",
      metadata: {
        id: fullName,
        name: fullName,
      },
      attributes: {
        kind: "tag",
        target,
      },
    });
  }

  const objectBody: DataElementNode[] = [];
  for (const [id, object] of sortedObjectEntries(snapshot.objects)) {
    if (object.type === "blob") {
      objectBody.push(serializeBlobObject(id, object));
      continue;
    }
    if (object.type === "tree") {
      objectBody.push(serializeTreeObject(id, object));
      continue;
    }
    if (object.type === "commit") {
      objectBody.push(serializeCommitObject(id, object));
      continue;
    }
    objectBody.push(serializeTagObject(id, object));
  }

  const body: XnlNode[] = [
    {
      kind: "DataElement",
      tag: "Refs",
      metadata: {},
      body: refsBody,
    },
    {
      kind: "DataElement",
      tag: "Objects",
      metadata: {},
      body: objectBody,
    },
  ];

  if (mode === "full") {
    body.push(buildContentsNode(snapshot.contents ?? {}));
  }

  return {
    kind: "DataElement",
    tag: "RepositorySnapshot",
    metadata: {
      id: "repository-snapshot",
      name: "RepositorySnapshot",
      version: "2",
    },
    attributes: {
      headType: snapshot.head.type,
      headValue: snapshot.head.type === "branch" ? snapshot.head.name : snapshot.head.commitId,
    },
    body,
  };
}

export function serializeRepositorySnapshotToString(snapshot: RepositoryStateSnapshot, options: SerializeRepositorySnapshotOptions = {}): string {
  return XNL.stringify(serializeRepositorySnapshot(snapshot, options), { pretty: true, indent: 2 });
}

function parseContents(snapshotNode: DataElementNode): Record<ContentKey, ContentSnapshotRecord> {
  const out: Record<ContentKey, ContentSnapshotRecord> = {};
  const contentsNode = firstChildByTag(snapshotNode, "Contents");
  if (!contentsNode) {
    return out;
  }

  for (const node of contentsNode.body ?? []) {
    const textNode = asTextElement(node);
    if (!textNode || textNode.tag !== "Content") {
      continue;
    }
    const id = typeof textNode.metadata?.id === "string" ? textNode.metadata.id : undefined;
    if (!id) {
      continue;
    }
    const contentType = asVfsFileType(textNode.metadata?.kind);
    const payload = typeof textNode.text === "string" ? textNode.text : "";
    const hashMeta = typeof textNode.metadata?.hash === "string" ? textNode.metadata.hash : undefined;
    const hash = hashMeta?.startsWith("sha256:") ? hashMeta.slice("sha256:".length) : sha256Hex(payload);
    const sizeMeta = textNode.metadata?.size;
    const size = typeof sizeMeta === "number" ? sizeMeta : new TextEncoder().encode(payload).length;
    out[id] = {
      contentKey: id,
      contentType,
      encoding: encodingForType(contentType),
      payload,
      hash,
      size,
    };
  }

  return out;
}

function deserializeObjects(snapshotNode: DataElementNode, contents: Record<ContentKey, ContentSnapshotRecord>): Record<ObjectId, VcsObject> {
  const out: Record<ObjectId, VcsObject> = {};
  const objectsNode = ensureDataElement(firstChildByTag(snapshotNode, "Objects"), "Objects");

  for (const node of objectsNode.body ?? []) {
    const element = ensureDataElement(node as XnlNode);
    const id = readStringMeta(element, "id");
    if (!id) {
      throw new VcsError("EINVAL", `<${element.tag}> missing metadata.id`);
    }

    if (element.tag === "Blob") {
      const fileType = asVfsFileType(readStringAttrFirst(element, "fileType"));
      const contentRef = readStringAttrFirst(element, "refId") ?? "";
      const record = contents[contentRef];
      const hashAttr = readStringAttrFirst(element, "hash");
      const contentHash = hashAttr?.startsWith("sha256:") ? hashAttr.slice("sha256:".length) : record?.hash ?? contentRef;
      const sizeAttr = element.attributes?.size ?? element.metadata?.size;
      const size = typeof sizeAttr === "number" ? sizeAttr : record?.size ?? 0;
      const contentTypeAttr = readStringAttrFirst(element, "contentType");
      out[id] = {
        type: "blob",
        fileType,
        contentRef,
        contentType: contentTypeAttr ? asVfsFileType(contentTypeAttr) : fileType,
        contentHash,
        size,
      };
      continue;
    }

    if (element.tag === "Tree") {
      const entriesNode = firstChildByTag(element, "Entries");
      const entries: TreeEntry[] = [];
      for (const entryNode of entriesNode?.body ?? []) {
        const entry = ensureDataElement(entryNode as XnlNode, "Entry");
        const kind = readStringAttrFirst(entry, "kind") === "tree" ? "folder" : "file";
        const objectId = readStringAttrFirst(entry, "oid");
        const name = readStringMeta(entry, "name");
        const metadataId = readStringAttrFirst(entry, "metadataId");
        if (!objectId || !name || !metadataId) {
          throw new VcsError("EINVAL", "Tree Entry missing required metadata");
        }
        const entryRecord: TreeEntry = {
          name,
          kind,
          objectId,
          metadataId,
        };

        const fileType = readStringAttrFirst(entry, "fileType");
        if (fileType) {
          entryRecord.fileType = asVfsFileType(fileType);
        }

        const metadataJson = readStringAttrFirst(entry, "metadataJson");
        if (metadataJson) {
          try {
            const parsed = JSON.parse(metadataJson) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              entryRecord.metadata = parsed as Record<string, unknown>;
            }
          } catch {
            // ignore malformed metadata payload from legacy snapshots
          }
        }

        if (entry.extend !== undefined) {
          entryRecord.extend = entry.extend;
        }

        entries.push(entryRecord);
      }

      const tree: TreeObject = {
        type: "tree",
        name: readStringMeta(element, "name") ?? "",
        metadataId: readStringAttrFirst(element, "metadataId") ?? "",
        entries,
      };
      const metadataJson = parseJsonAttribute(element, "metadataJson");
      if (metadataJson !== undefined) {
        if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) {
          throw new VcsError("EINVAL", "Tree metadataJson must encode an object");
        }
        tree.metadata = metadataJson as Record<string, unknown>;
      }
      const xnlVfsFormat = readStringAttrFirst(element, "xnlVfsFormat");
      if (xnlVfsFormat !== undefined) {
        if (xnlVfsFormat !== "xnl-vfs-v2") {
          throw new VcsError("EINVAL", `Unsupported XNL VFS tree format: ${xnlVfsFormat}`);
        }
        const xnlVfsSnapshot = parseJsonAttribute(element, "xnlVfsSnapshotJson");
        if (xnlVfsSnapshot === undefined) {
          throw new VcsError("EINVAL", "xnl-vfs-v2 tree missing snapshot payload");
        }
        const decoded = decodeLosslessVfsSnapshot(xnlVfsSnapshot);
        if (!isValidVfsSnapshotRoot(decoded)) {
          throw new VcsError("EINVAL", "xnl-vfs-v2 tree missing snapshot payload");
        }
        tree.xnlVfsFormat = xnlVfsFormat;
        tree.xnlVfsSnapshot = xnlVfsSnapshot as NonNullable<TreeObject["xnlVfsSnapshot"]>;
      }
      if (element.extend !== undefined) {
        tree.extend = element.extend;
      }
      out[id] = tree;
      continue;
    }

    if (element.tag === "Commit") {
      const tree = readStringAttrFirst(element, "tree");
      if (!tree) {
        throw new VcsError("EINVAL", "Commit missing tree reference");
      }
      const commit: CommitObject = {
        type: "commit",
        tree,
        parents: readStringArrayAttrFirst(element, "parents"),
        author: readStringAttrFirst(element, "author") ?? "system",
        message: readStringAttrFirst(element, "message") ?? "",
        timestamp: readStringAttrFirst(element, "timestamp") ?? new Date(0).toISOString(),
      };
      out[id] = commit;
      continue;
    }

    if (element.tag !== "Tag") {
      throw new VcsError("EINVAL", `Unknown repository object tag: <${element.tag}>`);
    }

    const target = readStringAttrFirst(element, "target");
    const name =
      readStringAttr(element, "name") ??
      readStringAttr(element, "tagName") ??
      readStringMeta(element, "name") ??
      readStringMeta(element, "tagName");
    if (!target || !name) {
      throw new VcsError("EINVAL", "Tag missing required metadata");
    }
    const tag: TagObject = {
      type: "tag",
      target,
      name,
      message: readStringAttrFirst(element, "message") ?? undefined,
    };
    out[id] = tag;
  }

  return out;
}

function deserializeRefs(snapshotNode: DataElementNode): { branches: Record<string, ObjectId | null>; tags: Record<string, ObjectId | null> } {
  const branches: Record<string, ObjectId | null> = {};
  const tags: Record<string, ObjectId | null> = {};
  const refsNode = ensureDataElement(firstChildByTag(snapshotNode, "Refs"), "Refs");

  for (const node of refsNode.body ?? []) {
    const ref = ensureDataElement(node as XnlNode, "Ref");
    const name = readStringMeta(ref, "name");
    if (!name) {
      continue;
    }
    const target = readNullableRef(ref);
    const kind = readStringAttrFirst(ref, "kind");

    if (kind === "branch" || name.startsWith("refs/heads/")) {
      branches[name.slice("refs/heads/".length)] = target;
      continue;
    }
    if (kind === "tag" || name.startsWith("refs/tags/")) {
      tags[name.slice("refs/tags/".length)] = target;
    }
  }

  return { branches, tags };
}

export function deserializeRepositorySnapshot(serialized: DataElementNode): RepositoryStateSnapshot {
  if (serialized.tag !== "RepositorySnapshot") {
    throw new VcsError("EINVAL", `Expected <RepositorySnapshot>, got <${serialized.tag}>`);
  }

  const contents = parseContents(serialized);
  const refs = deserializeRefs(serialized);
  const objects = deserializeObjects(serialized, contents);

  const headType = readStringAttrFirst(serialized, "headType") === "detached" ? "detached" : "branch";
  const headValue = readStringAttrFirst(serialized, "headValue");
  const head =
    headType === "branch"
      ? { type: "branch" as const, name: headValue ?? "main" }
      : { type: "detached" as const, commitId: headValue ?? "" };

  return {
    head,
    branches: refs.branches,
    tags: refs.tags,
    objects,
    contents,
  };
}

export function deserializeRepositorySnapshotFromString(input: string): RepositoryStateSnapshot {
  const document = parseXnl(input);
  const snapshotNode = document.nodes.find((node) => {
    return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement" && (node as DataElementNode).tag === "RepositorySnapshot");
  });
  if (!snapshotNode || typeof snapshotNode !== "object") {
    throw new VcsError("EINVAL", "No <RepositorySnapshot> node found in XNL document");
  }
  return deserializeRepositorySnapshot(snapshotNode as DataElementNode);
}
