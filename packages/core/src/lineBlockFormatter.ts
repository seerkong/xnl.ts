import { isLiteralObject } from "./value-context";
import type {
  AttributeMap,
  CommentNode,
  DataElementNode,
  ElementNode,
  TextElementNode,
  XnlDocument,
  XnlNode,
  XnlWord,
} from "./types";
import { isWord, wordToString } from "./types";

export interface LineBlockStringifyOptions {
  indent?: number | string;
  textMarkerFactory?: () => string;
  /**
   * Block text style: render every (non-inline) TextElement with its content on its
   * own line(s) between the open marker and `</?marker>`, indented to the element's
   * level — even single-line content. Pairs with the parser's `textBlockStyle` option
   * for stable round-trips. Default false keeps the legacy inline-open rendering.
   */
  textBlockStyle?: boolean;
}

interface StringifyState {
  indent: string;
  depth: number;
  textMarkerFactory: () => string;
  textBlockStyle: boolean;
}

const ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastUlidTime = -1;
let lastUlidRandom: number[] = [];

export function stringify(value: XnlDocument | XnlNode, options: LineBlockStringifyOptions = {}): string {
  const state: StringifyState = {
    indent: typeof options.indent === "string" ? options.indent : " ".repeat(options.indent ?? 2),
    depth: 0,
    textMarkerFactory: options.textMarkerFactory ?? makeUlid,
    textBlockStyle: options.textBlockStyle ?? false,
  };
  if (isDocument(value)) {
    return value.nodes.map((node) => serializeNode(node, state)).join("\n");
  }
  return serializeNode(value as XnlNode, state);
}

function serializeNode(node: XnlNode, state: StringifyState): string {
  if (isComment(node)) return `${pad(state)}<!-- ${node.value} -->`;
  if (isElement(node)) return serializeElement(node, state);
  return `${pad(state)}${serializeInlineValue(node, state)}`;
}

function serializeElement(node: ElementNode, state: StringifyState): string {
  if (node.kind === "TextElement") return serializeTextElement(node, state);
  return serializeDataElement(node, state);
}

function serializeTextElement(node: TextElementNode, state: StringifyState): string {
  const marker = node.textMarker ?? state.textMarkerFactory();
  const open = [
    `<${node.tag}`,
    serializeId(node.id),
    serializeMetadata(node.metadata, state),
    node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "",
    ` ?${marker}>`,
  ].join("");
  const text = node.text ?? "";
  const currentPad = pad(state);
  if (state.textBlockStyle && text !== "") {
    // block style: open marker, content on its own indented line(s), then </?marker>
    const body = text
      .split(/\r?\n/)
      .map((line) => (line === "" ? "" : `${currentPad}${line}`))
      .join("\n");
    return `${currentPad}${open}\n${body}\n${currentPad}</?${marker}>`;
  }
  const alignedText = text.replace(/\r?\n/g, (lineBreak) => `${lineBreak}${currentPad}`);
  return `${currentPad}${open}${alignedText}</?${marker}>`;
}

function serializeDataElement(node: DataElementNode, state: StringifyState): string {
  const open = [
    `<${node.tag}`,
    serializeId(node.id),
    serializeMetadata(node.metadata, state),
    node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "",
  ].join("");
  const sections: string[] = [];
  if (node.body) sections.push(serializeArrayBlock(node.body, state));
  if (node.extend) sections.push(serializeExtendBlock(node.extend, state));
  if (sections.length === 0) return `${pad(state)}${open}>`;
  if (sections.length === 1) return `${pad(state)}${open} ${sections[0]}>`;
  return `${pad(state)}${open} ${sections.join(" ")}>`;
}

function serializeArrayBlock(items: XnlNode[], state: StringifyState): string {
  if (items.length === 0) return "[]";
  const nextState = { ...state, depth: state.depth + 1 };
  const lines = items.map((item) => serializeNode(item, nextState));
  return `[\n${lines.join("\n")}\n${pad(state)}]`;
}

function serializeExtendBlock(
  extend: { order: string[]; children: Record<string, ElementNode> },
  state: StringifyState,
): string {
  if (extend.order.length === 0) return "()";
  const nextState = { ...state, depth: state.depth + 1 };
  const lines = extend.order.map((name) => serializeElement(extend.children[name], nextState));
  return `(\n${lines.join("\n")}\n${pad(state)})`;
}

function serializeMetadata(attrs: AttributeMap, state: StringifyState): string {
  const entries = Object.entries(attrs);
  if (entries.length === 0) return "";
  return " " + entries.map(([key, value]) => `${serializeKey(key)}=${serializeInlineValue(value, state)}`).join(" ");
}

function serializeAttributeBlock(attrs: AttributeMap, state: StringifyState): string {
  const entries = Object.entries(attrs)
    .map(([key, value]) => `${serializeKey(key)} = ${serializeInlineValue(value, state)}`)
    .join(" ");
  return `{ ${entries} }`;
}

function serializeInlineValue(value: XnlNode, state: StringifyState): string {
  if (isComment(value)) return `<!-- ${value.value} -->`;
  if (isElement(value)) return serializeInlineElement(value, state);
  if (isWord(value)) return formatWord(value);
  if (Array.isArray(value)) return serializeInlineArray(value, state);
  if (isPlainObject(value)) return serializeInlineObject(value as Record<string, XnlNode>, state);
  return serializePrimitive(value as string | number | boolean | null);
}

function serializeInlineElement(node: ElementNode, state: StringifyState): string {
  const marker = node.kind === "TextElement" ? (node.textMarker ?? state.textMarkerFactory()) : undefined;
  const open = [
    `<${node.tag}`,
    serializeId(node.id),
    serializeMetadata(node.metadata, state),
    node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "",
  ].join("");
  if (node.kind === "TextElement") return `${open} ?${marker}>${node.text ?? ""}</?${marker}>`;
  const sections: string[] = [];
  if (node.body) sections.push(serializeInlineArrayBlock(node.body, state));
  if (node.extend) sections.push(serializeInlineExtendBlock(node.extend, state));
  if (sections.length === 0) return `${open}>`;
  return `${open} ${sections.join(" ")}>`;
}

function serializeInlineArrayBlock(items: XnlNode[], state: StringifyState): string {
  return `[ ${items.map((item) => serializeInlineValue(item, state)).join(" ")} ]`;
}

function serializeInlineExtendBlock(
  extend: { order: string[]; children: Record<string, ElementNode> },
  state: StringifyState,
): string {
  return `( ${extend.order.map((name) => serializeInlineElement(extend.children[name], state)).join(" ")} )`;
}

function serializeInlineObject(value: Record<string, XnlNode>, state: StringifyState): string {
  const entries = Object.entries(value)
    .map(([key, child]) => `${serializeKey(key)} = ${serializeInlineValue(child, state)}`)
    .join(" ");
  return `{ ${entries} }`;
}

function serializeInlineArray(value: XnlNode[], state: StringifyState): string {
  return `[${value.map((child) => serializeInlineValue(child, state)).join(" ")}]`;
}

function serializePrimitive(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${escapeString(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function serializeId(id?: XnlWord): string {
  const value = formatWord(id);
  return value ? ` #${value}` : "";
}

function formatWord(word?: XnlWord): string {
  return wordToString(word) ?? "";
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

function pad(state: StringifyState): string {
  return state.indent.repeat(state.depth);
}

function isDocument(value: any): value is XnlDocument {
  return value && !isLiteralObject(value) && Array.isArray((value as XnlDocument).nodes);
}

function isElement(value: XnlNode): value is ElementNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !isLiteralObject(value) &&
    ((value as DataElementNode).kind === "DataElement" || (value as TextElementNode).kind === "TextElement")
  );
}

function isComment(value: XnlNode): value is CommentNode {
  return typeof value === "object" && value !== null && !isLiteralObject(value) && (value as CommentNode).kind === "Comment";
}

function isPlainObject(value: unknown): value is Record<string, XnlNode> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (isLiteralObject(value)) return true;
  const kind = (value as any).kind;
  return kind !== "DataElement" && kind !== "TextElement" && kind !== "Comment" && kind !== "Word";
}

function makeUlid(now = Date.now()): string {
  if (now > lastUlidTime) {
    lastUlidTime = now;
    lastUlidRandom = nextRandom();
  } else {
    lastUlidRandom = incrementRandom(lastUlidRandom);
  }
  return encodeTime(lastUlidTime, 10) + encodeRandom(lastUlidRandom);
}

function encodeTime(time: number, length: number): string {
  let out = "";
  for (let index = length - 1; index >= 0; index--) {
    out = ULID_ENCODING.charAt(time % 32) + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function encodeRandom(values: number[]): string {
  return values.map((value) => ULID_ENCODING.charAt(value)).join("");
}

function nextRandom(): number[] {
  return Array.from({ length: 16 }, () => (Math.random() * 32) | 0);
}

function incrementRandom(values: number[]): number[] {
  const next = [...values];
  for (let index = next.length - 1; index >= 0; index--) {
    if (next[index] < 31) {
      next[index] += 1;
      return next;
    }
    next[index] = 0;
  }
  return next;
}
