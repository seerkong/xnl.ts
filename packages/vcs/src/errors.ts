export type VcsErrorCode =
  | "ENOENT"
  | "ENOENT_OBJECT"
  | "EEXIST"
  | "ELOCKED"
  | "EINVAL"
  | "EDETACHEDHEAD"
  | "EDIRTYWORKTREE"
  | "BINARY_UNMERGEABLE"
  | "RENAME_RENAME"
  | "DELETE_MODIFY";

export class VcsError extends Error {
  readonly code: VcsErrorCode;

  constructor(code: VcsErrorCode, message: string) {
    super(message);
    this.name = "VcsError";
    this.code = code;
  }
}

export function assertVcs(condition: unknown, code: VcsErrorCode, message: string): asserts condition {
  if (!condition) {
    throw new VcsError(code, message);
  }
}
