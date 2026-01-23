import {
  AttributeMap,
  CommentNode,
  DataElementNode,
  ElementNode,
  TextElementNode,
  XnlDocument,
  XnlNode,
  XnlWord,
  isWord,
  wordToString,
} from "./types";

interface StringifyOptions {
  pretty?: boolean;
  indent?: number | string;
}

interface StringifyState {
  pretty: boolean;
  indent: string;
  depth: number;
}

export function stringify(value: XnlDocument | XnlNode, options: StringifyOptions = {}): string {
  const pretty = options.pretty === true;
  const indent = typeof options.indent === "string" ? options.indent : " ".repeat(options.indent ?? 0);
  const state: StringifyState = { pretty, indent, depth: 0 };
  const separator = pretty ? "\n" : "";
  const content = isDocument(value)
    ? (value.nodes as XnlNode[]).map((n) => serializeNode(n, state)).join(separator)
    : serializeNode(value as XnlNode, state);
  return content;
}

function isDocument(value: any): value is XnlDocument {
  return value && Array.isArray((value as XnlDocument).nodes);
}

function serializeNode(node: XnlNode, state: StringifyState): string {
  if (isComment(node)) {
    const pad = state.pretty ? state.indent.repeat(state.depth) : "";
    return `${pad}<!-- ${node.value} -->`;
  }
  if (isElement(node)) {
    const pad = state.pretty ? state.indent.repeat(state.depth) : "";
    if (node.kind === "TextElement") {
      const metaStr = serializeInlineAttributes(node.metadata, state);
      const attrStr = node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "";
      const idPart = node.id ? ` #${formatWord(node.id)}` : "";
      const marker = node.textMarker ?? "";
      return `${pad}<${node.tag}${idPart}${metaStr}${attrStr} ?${marker}>${node.text ?? ""}</?${marker}>`;
    }
    const metaStr = serializeInlineAttributes(node.metadata, state);
    const attrPart = node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "";
    const bodyPart = node.body ? ` ${serializeArrayBlock(node.body, state)}` : "";
    const extendPart = node.extend ? ` ${serializeExtendBlock(node.extend, state)}` : "";
    const idPart = node.id ? ` #${formatWord(node.id)}` : "";
    return `${pad}<${node.tag}${idPart}${metaStr}${attrPart}${bodyPart}${extendPart}>`;
  }
  if (Array.isArray(node)) {
    return serializeArrayLiteral(node, state);
  }
  if (isPlainObject(node)) {
    return serializeObjectLiteral(node as Record<string, XnlNode>, state);
  }
  return serializePrimitive(node as any);
}

function serializeInlineAttributes(attrs: AttributeMap, state: StringifyState): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(`${serializeKey(key)}=${serializeValueNode(value, state)}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function serializeAttributeBlock(attrs: AttributeMap, state: StringifyState): string {
  if (!state.pretty) {
    const entries = Object.entries(attrs)
      .map(([k, v]) => `${serializeKey(k)} = ${serializeValueNode(v, state)}`)
      .join(" ");
    return `{ ${entries} }`;
  }
  const nextDepth = state.depth + 1;
  const pad = state.indent.repeat(nextDepth);
  const lines = Object.entries(attrs).map(
    ([k, v]) => `${pad}${serializeKey(k)} = ${serializeValueNode(v, { ...state, depth: nextDepth })}`
  );
  const closingPad = state.indent.repeat(state.depth);
  return `{\n${lines.join("\n")}\n${closingPad}}`;
}

function serializeArrayBlock(items: XnlNode[], state: StringifyState): string {
  if (!state.pretty) {
    const serialized = items.map((item) => serializeValueNode(item, state)).join(" ");
    return `[ ${serialized} ]`;
  }
  const nextDepth = state.depth + 1;
  const pad = state.indent.repeat(nextDepth);
  const lines = items.map((item) => `${pad}${serializeValueNode(item, { ...state, depth: nextDepth })}`);
  const closingPad = state.indent.repeat(state.depth);
  return `[\n${lines.join("\n")}\n${closingPad}]`;
}

function serializeExtendBlock(extend: { order: string[]; children: Record<string, ElementNode> }, state: StringifyState): string {
  if (!state.pretty) {
    const children = extend.order.map((name) => serializeNode(extend.children[name], state)).join(" ");
    return `( ${children} )`;
  }
  const nextDepth = state.depth + 1;
  const pad = state.indent.repeat(nextDepth);
  const childStrings = extend.order.map((name) => `${pad}${serializeNode(extend.children[name], { ...state, depth: nextDepth })}`);
  const closingPad = state.indent.repeat(state.depth);
  return `(\n${childStrings.join("\n")}\n${closingPad})`;
}

function serializeValueNode(node: XnlNode, state: StringifyState): string {
  if (isComment(node) || isElement(node)) return serializeNode(node, state);
  if (isWord(node)) return formatWord(node);
  if (Array.isArray(node)) return serializeArrayLiteral(node, state);
  if (isPlainObject(node)) return serializeObjectLiteral(node as Record<string, XnlNode>, state);
  return serializePrimitive(node as any);
}

function serializePrimitive(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${escapeString(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function serializeObjectLiteral(obj: Record<string, XnlNode>, state: StringifyState): string {
  if (!state.pretty) {
    return `{ ${Object.entries(obj)
      .map(([k, v]) => `${serializeKey(k)} = ${serializeValueNode(v, state)}`)
      .join(" ")} }`;
  }
  const nextDepth = state.depth + 1;
  const pad = state.indent.repeat(nextDepth);
  const lines = Object.entries(obj).map(
    ([k, v]) => `${pad}${serializeKey(k)} = ${serializeValueNode(v, { ...state, depth: nextDepth })}`
  );
  const closingPad = state.indent.repeat(state.depth);
  return `{\n${lines.join("\n")}\n${closingPad}}`;
}

function serializeArrayLiteral(arr: XnlNode[], state: StringifyState): string {
  if (!state.pretty) {
    return `[${arr.map((v) => serializeValueNode(v, state)).join(" ")}]`;
  }
  const nextDepth = state.depth + 1;
  const pad = state.indent.repeat(nextDepth);
  const lines = arr.map((v) => `${pad}${serializeValueNode(v, { ...state, depth: nextDepth })}`);
  const closingPad = state.indent.repeat(state.depth);
  return `[\n${lines.join("\n")}\n${closingPad}]`;
}

function isComment(node: XnlNode): node is CommentNode {
  return typeof node === "object" && node !== null && (node as CommentNode).kind === "Comment";
}

function isElement(node: XnlNode): node is ElementNode {
  return (
    typeof node === "object" &&
    node !== null &&
    ((node as DataElementNode).kind === "DataElement" || (node as TextElementNode).kind === "TextElement")
  );
}

function isPlainObject(value: any): value is Record<string, XnlNode> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as any).kind === undefined;
}

function serializeKey(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return key;
  return `"${escapeString(key)}"`;
}

function escapeString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

function formatWord(word: XnlWord): string {
  return wordToString(word) ?? "";
}
