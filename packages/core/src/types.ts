import { isLiteralObject } from "./value-context";

export type ValueLiteral = string | boolean | null | number;

export type AttributeMap = Record<string, XnlNode>;

export interface ExtendBody {
  order: string[];
  children: Record<string, ElementNode>;
}

export type ElementNode = DataElementNode | TextElementNode;
export type ElementNodeKind = 'DataElement' | 'TextElement';

export interface DataElementNode {
  kind: "DataElement";
  tag: string;
  id?: XnlWord;
  metadata: AttributeMap;
  attributes?: AttributeMap;
  body?: XnlNode[];
  extend?: ExtendBody;
}

export interface XnlWord {
  kind: "Word";
  namespace: string[];
  name: string;
}

export interface TextElementNode {
  kind: "TextElement";
  tag: string;
  id?: XnlWord;
  metadata: AttributeMap;
  attributes?: AttributeMap;
  text?: string;
  textMarker?: string;
}

export interface CommentNode {
  kind: "Comment";
  value: string;
}

export type ContainerNode = Array<XnlNode> | Object | ElementNode;

export type XnlNode = ValueLiteral | XnlWord | ContainerNode | CommentNode;

export function isWord(value: any): value is XnlWord {
  return value !== null && typeof value === "object" && !isLiteralObject(value) && (value as any).kind === "Word";
}

export function wordToString(word?: XnlWord | null): string | undefined {
  if (!word) return undefined;
  const ns = word.namespace ?? [];
  const parts = [...ns.filter(Boolean), word.name].filter((p) => p !== undefined && p !== null);
  const str = parts.join(".");
  return str.length ? str : undefined;
}


export type ParseWarningCode = "DUPLICATE_CHILD";

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  parentName: string;
  childName: string;
}

export interface XnlDocument {
  nodes: XnlNode[];
  warnings?: ParseWarning[];
}

export interface SingleNodeResult {
  node: XnlNode;
  warnings: ParseWarning[];
}

export interface UniqueChildrenResult {
  node: XnlNode;
  warnings: ParseWarning[];
}
