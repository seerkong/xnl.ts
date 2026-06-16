import type { ExtendBody } from "xnl-core";
import type { VfsFileType } from "xnl-vfs";
import type { ObjectId } from "./hash";

/** Content format. Equals the file's VfsFileType. */
export type ContentType = VfsFileType;

/** Key into the content store. Content-addressed: equals sha256(content). */
export type ContentKey = string;

/**
 * Blob object. The blob does not inline its content; it references a row in the
 * content store (see ContentStore). This keeps the object graph small and
 * enables binary content, dedup-by-hash and large-object handling. Tree/blob
 * metadata (metadataId, metadata, extend) is retained on TreeEntry/TreeObject.
 */
export interface BlobObject {
  type: "blob";
  fileType: VfsFileType;
  contentRef: ContentKey;
  contentType: ContentType;
  contentHash: string;
  size: number;
}

export interface TreeEntry {
  name: string;
  kind: "file" | "folder";
  objectId: ObjectId;
  metadataId: string;
  fileType?: VfsFileType;
  metadata?: Record<string, unknown>;
  extend?: ExtendBody;
}

export interface TreeObject {
  type: "tree";
  name: string;
  metadataId: string;
  extend?: ExtendBody;
  metadata?: Record<string, unknown>;
  entries: TreeEntry[];
}

export interface CommitObject {
  type: "commit";
  tree: ObjectId;
  parents: ObjectId[];
  author: string;
  message: string;
  timestamp: string;
}

export interface TagObject {
  type: "tag";
  target: ObjectId;
  name: string;
  message?: string;
}

export type VcsObject = BlobObject | TreeObject | CommitObject | TagObject;

export interface FileSnapshot {
  path: string;
  metadataId: string;
  fileType: VfsFileType;
  content: string;
  metadata?: Record<string, unknown>;
  extend?: ExtendBody;
}

export interface MergeConflict {
  type: "RENAME_RENAME" | "DELETE_MODIFY" | "BINARY_UNMERGEABLE";
  metadataId: string;
  basePath?: string;
  oursPath?: string;
  theirsPath?: string;
  details?: Record<string, unknown>;
}

export interface MergeResolution {
  metadataId: string;
  choice: "ours" | "theirs" | "base";
}
