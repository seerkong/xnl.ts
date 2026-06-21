import { XnlParseError } from "./errors";
import {
  AttributeMap,
  DataElementNode,
  ExtendBody,
  ParseWarning,
  SingleNodeResult,
  XnlDocument,
  XnlNode,
  TextElementNode,
  UniqueChildrenResult,
  XnlWord,
} from "./types";

/** Options for parsing. */
export interface XnlParseOptions {
  /**
   * Block text style: in addition to the always-on leading-newline strip + dedent,
   * also strip the single structural trailing newline that the block formatter emits
   * before the closing `</?marker>`. Symmetric inverse of the formatter's
   * `textBlockStyle` option, giving stable round-trips for multi-line text blocks.
   */
  textBlockStyle?: boolean;
}

interface ParseState {
  input: string;
  pos: number;
  length: number;
  warnings: ParseWarning[];
  textBlockStyle: boolean;
}

export function parseXnl(input: string, options: XnlParseOptions = {}): XnlDocument {
  const warnings: ParseWarning[] = [];
  const nodes = parseNodesFromString(input, warnings, options);
  return { nodes, warnings };
}

export function parseXnlSingleNode(input: string, options: XnlParseOptions = {}): SingleNodeResult {
  const warnings: ParseWarning[] = [];
  const state: ParseState = {
    input,
    pos: 0,
    length: input.length,
    warnings,
    textBlockStyle: options.textBlockStyle ?? false,
  };
  skipWhitespaceAndComments(state);
  const node = parseNode(state);
  skipWhitespaceAndComments(state);
  if (!eof(state)) {
    throw error(state, "UNEXPECTED_TOKEN", "Expected a single node");
  }
  return { node, warnings };
}

export function parseUniqueChildren(
  name: string,
  input: string,
  metadata: AttributeMap = {},
  attributes: AttributeMap = {}
): UniqueChildrenResult {
  const warnings: ParseWarning[] = [];
  const children = parseNodesFromString(input, warnings);
  const extend = buildExtendBody(children, name, warnings);
  const node: DataElementNode = { kind: "DataElement", tag: name, id: undefined, metadata, attributes, extend };
  return { node, warnings };
}

function parseNodesFromString(
  input: string,
  warnings: ParseWarning[],
  options: XnlParseOptions = {}
): XnlNode[] {
  const state: ParseState = {
    input,
    pos: 0,
    length: input.length,
    warnings,
    textBlockStyle: options.textBlockStyle ?? false,
  };
  const nodes: XnlNode[] = [];
  skipWhitespaceAndComments(state);
  while (!eof(state)) {
    nodes.push(parseNode(state));
    skipWhitespaceAndComments(state);
  }
  return nodes;
}

function parseNode(state: ParseState): DataElementNode | TextElementNode {
  consumeChar(state, "<", "UNEXPECTED_TOKEN", "Expected '<' to start a node");
  const tag = readTagName(state);
  skipWhitespaceAndComments(state);
  const id = parseOptionalId(state);
  const metadata = parseMetadata(state);

  let attributes: AttributeMap | undefined;
  let body: XnlNode[] | undefined;
  let extend: ExtendBody | undefined;
  let text: string | undefined;
  let textMarker: string | undefined;

  skipWhitespaceAndComments(state);

  // Text node start
  if (consumeIf(state, "?")) {
    ({ text, textMarker } = parseTextBody(state, tag));
    return { kind: "TextElement", tag, id, metadata, attributes, text, textMarker };
  }

  // Parse zero or more section blocks until '>' or '?'
  while (true) {
    if (lookAhead(state, ">")) {
      state.pos += 1;
      return { kind: "DataElement", tag, id, metadata, attributes, body, extend };
    }
    if (lookAhead(state, "?")) {
      state.pos += 1;
      if (body || extend) {
        throw error(state, "INVALID_CONTENT", `Text block not allowed with array/extend sections in <${tag}>`);
      }
      ({ text, textMarker } = parseTextBody(state, tag));
      return { kind: "TextElement", tag, id, metadata, attributes, text, textMarker };
    }
    if (lookAhead(state, "{")) {
      if (attributes) {
        throw error(state, "INVALID_CONTENT", "Multiple attribute blocks are not allowed");
      }
      attributes = parseAttributeBlock(state, tag);
      skipWhitespaceAndComments(state);
      continue;
    }
    if (lookAhead(state, "[")) {
      if (text) throw error(state, "INVALID_CONTENT", `Text block cannot include array block in <${tag}>`);
      if (body) {
        throw error(state, "INVALID_CONTENT", "Multiple array blocks are not allowed");
      }
      body = parseArrayBody(state, tag);
      skipWhitespaceAndComments(state);
      continue;
    }
    if (lookAhead(state, "(")) {
      if (text) throw error(state, "INVALID_CONTENT", `Text block cannot include extend block in <${tag}>`);
      if (extend) {
        throw error(state, "INVALID_CONTENT", "Multiple extend blocks are not allowed");
      }
      extend = parseExtendBody(state, tag);
      skipWhitespaceAndComments(state);
      continue;
    }
    if (eof(state)) {
      throw error(state, "UNEXPECTED_EOF", "Unexpected end of input");
    }
      throw error(state, "UNEXPECTED_TOKEN", `Unexpected token '${peek(state)}' while parsing node <${tag}>`);
  }
}

function parseMetadata(state: ParseState): AttributeMap {
  const attrs: AttributeMap = {};
  while (true) {
    skipWhitespaceAndComments(state);
    if (lookAhead(state, "{") || lookAhead(state, "[") || lookAhead(state, "(") || lookAhead(state, "?") || lookAhead(state, ">")) {
      break;
    }
    if (eof(state)) {
      throw error(state, "UNEXPECTED_EOF", "Unexpected end while reading metadata");
    }
    const key = readKey(state, "Expected metadata key");
    skipWhitespaceAndComments(state);
    consumeChar(state, "=", "UNEXPECTED_TOKEN", "Expected '=' after metadata key");
    skipWhitespaceAndComments(state);
    attrs[key] = parseValueNode(state);
  }
  return attrs;
}

function parseAttributeBlock(state: ParseState, name: string): AttributeMap {
  consumeChar(state, "{", "UNEXPECTED_TOKEN", "Expected '{' to start attribute block");
  const attrs: AttributeMap = {};
  while (true) {
    skipWhitespaceAndComments(state);
    if (consumeIf(state, "}")) {
      return attrs;
    }
    if (eof(state)) {
      throw error(state, "UNEXPECTED_EOF", `Missing closing '}' for attributes in <${name}>`);
    }
    const key = readKey(state, "Expected key in attribute block");
    skipWhitespaceAndComments(state);
    consumeChar(state, "=", "UNEXPECTED_TOKEN", "Expected '=' after key in attribute block");
    skipWhitespaceAndComments(state);
    attrs[key] = parseValueNode(state);
  }
}

function parseArrayBody(state: ParseState, name: string): XnlNode[] {
  consumeChar(state, "[", "UNEXPECTED_TOKEN", "Expected '[' to start array block");
  const items: XnlNode[] = [];
  while (true) {
    skipWhitespaceAndComments(state);
    if (consumeIf(state, "]")) {
      return items;
    }
    if (eof(state)) {
      throw error(state, "UNEXPECTED_EOF", `Missing closing ']' for array in <${name}>`);
    }
    if (lookAhead(state, "<")) {
      items.push(parseNode(state));
    } else {
      items.push(parseValueNode(state));
    }
  }
}

function parseExtendBody(state: ParseState, name: string): ExtendBody {
  consumeChar(state, "(", "UNEXPECTED_TOKEN", "Expected '(' to start extend block");
  const children: Record<string, DataElementNode | TextElementNode> = {};
  const order: string[] = [];
  while (true) {
    skipWhitespaceAndComments(state);
    if (consumeIf(state, ")")) {
      return { children, order };
    }
    if (eof(state)) {
      throw error(state, "UNEXPECTED_EOF", `Missing closing ')' for extend in <${name}>`);
    }
    if (!lookAhead(state, "<")) {
      throw error(state, "INVALID_CONTENT", `Extend block inside <${name}> must contain child nodes`);
    }
    const child = parseNode(state);
    mergeChild(children, order, child, name, state.warnings);
  }
}

function parseOptionalId(state: ParseState): XnlWord | undefined {
  if (!consumeIf(state, "#")) return undefined;
  const word = parseWordLiteral(state);
  skipWhitespaceAndComments(state);
  return word;
}

function parseTextBody(state: ParseState, name: string): { text: string; textMarker?: string } {
  const marker = readOptionalMarker(state);
  consumeChar(state, ">", "UNEXPECTED_TOKEN", "Expected '>' after text marker");
  const start = state.pos;

  while (true) {
    const idx = state.input.indexOf("</?", state.pos);
    if (idx === -1) {
      throw error(state, "MISMATCHED_TAG", `Missing closing text tag </?${marker ?? ""}> for <${name}>`);
    }
    const markerStart = idx + 3;
    let i = markerStart;
    while (i < state.length && isIdentifierChar(state.input[i])) i++;
    const foundMarker = state.input.slice(markerStart, i);
    if (state.input[i] !== ">") {
      state.pos = idx;
      throw error(
        state,
        "UNEXPECTED_TOKEN",
        `Invalid closing text tag for <${name}>; expected '>' after marker '${foundMarker}'`
      );
    }
    if ((marker ?? "") !== foundMarker) {
      state.pos = idx;
      throw error(
        state,
        "MISMATCHED_TAG",
        `Mismatched text marker for <${name}>: expected '${marker ?? ""}' but found '${foundMarker}'`
      );
    }
    const closingIndent = indentationBefore(state.input, idx);
    let content = stripComments(dedentContent(state.input.slice(start, idx), closingIndent));
    if (state.textBlockStyle && content.endsWith("\n")) {
      // drop the single structural trailing newline the block formatter emits before </?marker>
      content = content.slice(0, -1);
    }
    state.pos = i + 1;
    return { text: content, textMarker: marker ?? undefined };
  }
}

function buildExtendBody(nodes: XnlNode[], parentName: string, warnings: ParseWarning[]): ExtendBody {
  const children: Record<string, DataElementNode | TextElementNode> = {};
  const order: string[] = [];
  for (const node of nodes) {
    const element = node as DataElementNode | TextElementNode;
    if (element.kind !== "DataElement" && element.kind !== "TextElement") continue;
    mergeChild(children, order, element, parentName, warnings);
  }
  return { children, order };
}

function mergeChild(
  children: Record<string, DataElementNode | TextElementNode>,
  order: string[],
  node: DataElementNode | TextElementNode,
  parentName: string,
  warnings: ParseWarning[]
): void {
  if (children[node.tag]) {
    warnings.push({
      code: "DUPLICATE_CHILD",
      message: `Duplicate child '${node.tag}' inside <${parentName} ( ... )> (later node overwrote earlier)`,
      parentName,
      childName: node.tag,
    });
    const idx = order.indexOf(node.tag);
    if (idx !== -1) order.splice(idx, 1);
  }
  children[node.tag] = node;
  order.push(node.tag);
}

function parseValueNode(state: ParseState): XnlNode {
  const ch = state.input[state.pos];
  if (ch === "<") return parseNode(state);
  if (ch === "{") return parseObjectLiteral(state);
  if (ch === "[") return parseArrayLiteral(state);
  if (ch === "'" || ch === '"') return parseStringLiteral(state);
  if (startsWithNumber(state)) return parseNumberLiteral(state);
  if (startsWithBoolean(state)) return parseBooleanLiteral(state);
  if (startsWithNull(state)) return parseNullLiteral(state);
  if (isIdentifierStart(ch)) return parseWordLiteral(state);

  throw error(state, "INVALID_LITERAL", `Unexpected literal starting with '${ch}'`);
}

function parseObjectLiteral(state: ParseState): Record<string, XnlNode> {
  consumeChar(state, "{", "UNEXPECTED_TOKEN", "Expected '{' to start object literal");
  const entries: Record<string, XnlNode> = {};
  while (true) {
    skipWhitespaceAndComments(state);
    if (consumeIf(state, "}")) break;
    const key = readKey(state, "Expected key in object literal");
    skipWhitespaceAndComments(state);
    consumeChar(state, "=", "UNEXPECTED_TOKEN", "Expected '=' after key in object literal");
    skipWhitespaceAndComments(state);
    entries[key] = parseValueNode(state);
    skipWhitespaceAndComments(state);
  }
  return entries;
}

function parseArrayLiteral(state: ParseState): XnlNode[] {
  consumeChar(state, "[", "UNEXPECTED_TOKEN", "Expected '[' to start array literal");
  const items: XnlNode[] = [];
  while (true) {
    skipWhitespaceAndComments(state);
    if (consumeIf(state, "]")) break;
    items.push(parseValueNode(state));
    skipWhitespaceAndComments(state);
  }
  return items;
}

function parseStringLiteral(state: ParseState): string {
  const quote = consume(state);
  let value = "";
  while (!eof(state)) {
    const ch = consume(state);
    if (ch === quote) {
      return value;
    }
    if (ch === "\\") {
      const next = consume(state);
      if (next === "n") value += "\n";
      else if (next === "t") value += "\t";
      else if (next === '"') value += '"';
      else if (next === "'") value += "'";
      else value += next;
    } else {
      value += ch;
    }
  }
  throw error(state, "UNEXPECTED_EOF", "Unterminated string literal");
}

function parseNumberLiteral(state: ParseState): number {
  const start = state.pos;
  if (state.input[state.pos] === "+" || state.input[state.pos] === "-") {
    state.pos++;
  }
  while (isDigit(peek(state))) {
    state.pos++;
  }
  if (peek(state) === ".") {
    state.pos++;
    if (!isDigit(peek(state))) {
      throw error(state, "INVALID_LITERAL", "Invalid float literal");
    }
    while (isDigit(peek(state))) state.pos++;
  }
  if (peek(state) && (peek(state) === "e" || peek(state) === "E")) {
    state.pos++;
    if (peek(state) === "+" || peek(state) === "-") state.pos++;
    if (!isDigit(peek(state))) throw error(state, "INVALID_LITERAL", "Invalid exponent in number");
    while (isDigit(peek(state))) state.pos++;
  }
  const raw = state.input.slice(start, state.pos);
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw error(state, "INVALID_LITERAL", "Invalid number literal");
  }
  return value;
}

function parseBooleanLiteral(state: ParseState): boolean {
  if (lookAhead(state, "true")) {
    state.pos += 4;
    return true;
  }
  if (lookAhead(state, "false")) {
    state.pos += 5;
    return false;
  }
  throw error(state, "INVALID_LITERAL", "Invalid boolean literal");
}

function parseNullLiteral(state: ParseState): null {
  consumeString(state, "null", "INVALID_LITERAL", "Invalid null literal");
  return null;
}

function parseWordLiteral(state: ParseState): XnlWord {
  const first = readIdentifier(state, "Expected identifier literal");
  const parts = [first];
  while (lookAhead(state, ".")) {
    state.pos += 1;
    const next = readIdentifier(state, "Expected identifier segment after '.'");
    parts.push(next);
  }
  const name = parts.pop() as string;
  return { kind: "Word", namespace: parts, name };
}

function readOptionalMarker(state: ParseState): string | undefined {
  if (!isMarkerStart(peek(state))) return undefined;
  return readMarker(state);
}

function readMarker(state: ParseState): string {
  const start = state.pos;
  while (!eof(state) && isIdentifierChar(state.input[state.pos])) {
    state.pos++;
  }
  return state.input.slice(start, state.pos);
}

function readKey(state: ParseState, message: string): string {
  const ch = peek(state);
  if (ch === "\"" || ch === "'") {
    return parseStringLiteral(state);
  }
  return readIdentifier(state, message);
}

// Tag names may be dotted FQNs: seg(.seg)*, each segment an identifier.
function readTagName(state: ParseState): string {
  const parts = [readIdentifier(state, "Expected node name")];
  while (lookAhead(state, ".")) {
    state.pos += 1;
    parts.push(readIdentifier(state, "Expected tag segment after '.'"));
  }
  return parts.join(".");
}

function readIdentifier(state: ParseState, message: string): string {
  const start = state.pos;
  const first = state.input[state.pos];
  if (!isIdentifierStart(first)) {
    throw error(state, "UNEXPECTED_TOKEN", message);
  }
  state.pos++;
  while (!eof(state) && isIdentifierChar(state.input[state.pos])) {
    state.pos++;
  }
  return state.input.slice(start, state.pos);
}

function startsWithNumber(state: ParseState): boolean {
  const ch = state.input[state.pos];
  if (ch === "+" || ch === "-") {
    const next = peek(state, 1);
    return next !== undefined && isDigit(next);
  }
  return isDigit(ch);
}

function startsWithBoolean(state: ParseState): boolean {
  return lookAhead(state, "true") || lookAhead(state, "false");
}

function startsWithNull(state: ParseState): boolean {
  return lookAhead(state, "null");
}

function consumeIf(state: ParseState, token: string): boolean {
  if (lookAhead(state, token)) {
    state.pos += token.length;
    return true;
  }
  return false;
}

function consumeString(state: ParseState, token: string, code: any, message: string): void {
  if (!lookAhead(state, token)) {
    throw error(state, code, message);
  }
  state.pos += token.length;
}

function lookAhead(state: ParseState, token: string): boolean {
  return state.input.startsWith(token, state.pos);
}

function consumeChar(state: ParseState, expected: string, code: any, message: string): string {
  const ch = consume(state);
  if (ch !== expected) {
    throw error(state, code, message);
  }
  return ch;
}

function consume(state: ParseState): string {
  if (eof(state)) throw error(state, "UNEXPECTED_EOF", "Unexpected end of input");
  const ch = state.input[state.pos];
  state.pos += 1;
  return ch;
}

function skipWhitespaceAndComments(state: ParseState): void {
  while (!eof(state)) {
    const ch = state.input[state.pos];
    if (isWhitespace(ch)) {
      state.pos++;
      continue;
    }
    if (lookAhead(state, "<!--")) {
      skipComment(state);
      continue;
    }
    break;
  }
}

function indentationBefore(input: string, index: number): string {
  const lastNewline = input.lastIndexOf("\n", index - 1);
  if (lastNewline === -1) return "";
  const indent = input.slice(lastNewline + 1, index);
  return /^[ \t]*$/.test(indent) ? indent : "";
}

function dedentContent(content: string, indent: string): string {
  if (!content.includes("\n") || indent === "") return content;
  const lines = content.split("\n");
  const startIndex = lines[0].length === 0 ? 1 : 0;
  const dedented = lines.slice(startIndex).map((line) => {
    let remove = 0;
    while (
      remove < indent.length &&
      remove < line.length &&
      line[remove] === indent[remove] &&
      (indent[remove] === " " || indent[remove] === "\t")
    ) {
      remove++;
    }
    return line.slice(remove);
  });
  return dedented.join("\n");
}

function stripComments(content: string): string {
  return content.replace(/<!--[\\s\\S]*?-->/g, "");
}

function eof(state: ParseState): boolean {
  return state.pos >= state.length;
}

function peek(state: ParseState, offset = 0): string | undefined {
  const idx = state.pos + offset;
  return idx < state.length ? state.input[idx] : undefined;
}

function isIdentifierStart(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[A-Za-z_]/.test(ch);
}

function isIdentifierChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[A-Za-z0-9_-]/.test(ch);
}

function isMarkerStart(ch: string | undefined): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function error(state: ParseState, code: any, message: string): XnlParseError {
  return new XnlParseError(code, message, state.input, state.pos);
}

function skipComment(state: ParseState): void {
  if (!lookAhead(state, "<!--")) return;
  const end = state.input.indexOf("-->", state.pos + 4);
  if (end === -1) {
    throw error(state, "UNEXPECTED_EOF", "Unterminated comment");
  }
  state.pos = end + 3;
}
