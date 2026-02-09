import * as Parser from "./parser";
import { stringify as xnlStringify } from "./formatter";
import { parsePath, resolvePath, setPathValue, deleteAtPath } from "./path";
import { applyMutations, diffNodes } from "./mutation";
import { loadFromString, resolveNode, batchLoad } from "./loader";
export { parseXnl } from "./parser";
export { parseXnlSingleNode, parseUniqueChildren } from "./parser";
export { XnlParseError } from "./errors";
export type { XnlErrorCode } from "./errors";
export type {
  AttributeMap,
  ValueLiteral,
  XnlDocument,
  XnlNode,
  CommentNode,
  ParseWarning,
  SingleNodeResult,
  UniqueChildrenResult,
  ExtendBody,
  ElementNode,
  DataElementNode,
  TextElementNode,
  ElementNodeKind,
  XnlWord,
} from "./types";
export { isWord, wordToString } from "./types";
export type { PathItem, PathItemType, XnlPath } from "./path";
export type { XnlMutation, MutationType, XnlMutationOptions, MetadataIdMode } from "./mutation";
export {
  parsePath,
  resolvePath,
  setPathValue,
  deleteAtPath,
  XnlPathError,
} from "./path";
export { applyMutations, diffNodes } from "./mutation";
export { loadFromString, resolveNode as loadNode, batchLoad } from "./loader";
export { GetWordFullName, MakeWord } from "./NodeHelper";

export const XNL = {
  parseMany: Parser.parseXnl,
  parseSingle: Parser.parseXnlSingleNode,
  parseUnique: Parser.parseUniqueChildren,
  stringify: xnlStringify,
  path: {
    parse: parsePath,
    resolve: resolvePath,
    set: setPathValue,
    delete: deleteAtPath,
  },
  mutation: {
    apply: applyMutations,
    diff: diffNodes,
  },
  loader: {
    loadFromString,
    loadNode: resolveNode,
    batchLoad,
  },
};
