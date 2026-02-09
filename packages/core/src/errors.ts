import { positionToLineColumn } from "./position";

export type XnlErrorCode =
  | "UNEXPECTED_EOF"
  | "MISMATCHED_TAG"
  | "DUPLICATE_CHILD"
  | "INVALID_CONTENT"
  | "INVALID_LITERAL"
  | "UNEXPECTED_TOKEN";

export class XnlParseError extends Error {
  readonly code: XnlErrorCode;
  readonly position: number;
  readonly line: number;
  readonly column: number;

  constructor(code: XnlErrorCode, message: string, input: string, position: number) {
    const { line, column } = positionToLineColumn(input, position);
    super(`${message} (at ${line}:${column})`);
    this.code = code;
    this.position = position;
    this.line = line;
    this.column = column;
  }
}
