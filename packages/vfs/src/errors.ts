export type VfsErrorCode =
  | "ENOENT"
  | "EEXIST"
  | "ENOTDIR"
  | "EISDIR"
  | "ENOTEMPTY"
  | "EINVAL"
  | "ERESERVED"
  | "BINARY_UNMERGEABLE"
  | "EDIRTYWORKTREE"
  | "EDETACHEDHEAD"
  | "ENOENT_OBJECT";

export class VfsError extends Error {
  readonly code: VfsErrorCode;

  constructor(code: VfsErrorCode, message: string) {
    super(message);
    this.name = "VfsError";
    this.code = code;
  }
}

export function assertVfs(condition: unknown, code: VfsErrorCode, message: string): asserts condition {
  if (!condition) {
    throw new VfsError(code, message);
  }
}
