import type { DataElementNode, ExtendBody, XnlMutation } from "xnl-core";

export type VfsFileType = "xnl" | "text" | "binary";

export interface VfsStat {
  kind: "file" | "folder";
  path: string;
  name: string;
  metadataId: string;
  fileType?: VfsFileType;
  size?: number;
}

export interface VfsEntry {
  name: string;
  path: string;
  kind: "file" | "folder";
  metadataId: string;
  fileType?: VfsFileType;
}

export interface WriteFileOptions {
  fileType?: VfsFileType;
  overwrite?: boolean;
  extend?: ExtendBody;
  metadataId?: string;
}

export interface MkdirOptions {
  recursive?: boolean;
}

export interface RenameOptions {
  overwrite?: boolean;
}

export interface CopyOptions {
  overwrite?: boolean;
}

export interface RmdirOptions {
  recursive?: boolean;
}

export interface VfsApplyResult {
  snapshot: DataElementNode;
}

export type XnlDiff = XnlMutation[];

export interface TextDiffChunk {
  op: "equal" | "insert" | "delete";
  text: string;
}

export interface BinaryDiff {
  oldHash: string;
  newHash: string;
  replacement: string;
}

export interface BinaryMergeConflict {
  type: "BINARY_UNMERGEABLE";
  base: string;
  ours: string;
  theirs: string;
}

export interface ContractsDocument {
  pathExamples: Array<{ input: string; output: string }>;
  errorMappings: Array<{ code: string; operation: string; trigger: string }>;
}

export interface VirtualFileSystemOptions {
  reservedNames?: string[];
}
