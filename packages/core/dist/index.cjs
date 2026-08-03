'use strict';

// src/position.ts
function positionToLineColumn(input, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < input.length; i++) {
    const ch = input[i];
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

// src/errors.ts
var XnlParseError = class extends Error {
  constructor(code, message, input, position) {
    const { line, column } = positionToLineColumn(input, position);
    super(`${message} (at ${line}:${column})`);
    this.code = code;
    this.position = position;
    this.line = line;
    this.column = column;
  }
};

// src/parser.ts
function parseXnl(input, options = {}) {
  const warnings = [];
  const nodes = parseNodesFromString(input, warnings, options);
  return { nodes, warnings };
}
function parseXnlSingleNode(input, options = {}) {
  const warnings = [];
  const state = {
    input,
    pos: 0,
    length: input.length,
    warnings,
    textBlockStyle: options.textBlockStyle ?? false
  };
  skipWhitespaceAndComments(state);
  const node = parseNode(state);
  skipWhitespaceAndComments(state);
  if (!eof(state)) {
    throw error(state, "UNEXPECTED_TOKEN", "Expected a single node");
  }
  return { node, warnings };
}
function parseUniqueChildren(name, input, metadata = {}, attributes = {}) {
  const warnings = [];
  const children = parseNodesFromString(input, warnings);
  const extend = buildExtendBody(children, name, warnings);
  const node = { kind: "DataElement", tag: name, id: void 0, metadata, attributes, extend };
  return { node, warnings };
}
function parseNodesFromString(input, warnings, options = {}) {
  const state = {
    input,
    pos: 0,
    length: input.length,
    warnings,
    textBlockStyle: options.textBlockStyle ?? false
  };
  const nodes = [];
  skipWhitespaceAndComments(state);
  while (!eof(state)) {
    nodes.push(parseNode(state));
    skipWhitespaceAndComments(state);
  }
  return nodes;
}
function parseNode(state) {
  consumeChar(state, "<", "UNEXPECTED_TOKEN", "Expected '<' to start a node");
  const tag = readTagName(state);
  skipWhitespaceAndComments(state);
  const id = parseOptionalId(state);
  const metadata = parseMetadata(state);
  let attributes;
  let body;
  let extend;
  let text;
  let textMarker;
  skipWhitespaceAndComments(state);
  if (consumeIf(state, "?")) {
    ({ text, textMarker } = parseTextBody(state, tag));
    return { kind: "TextElement", tag, id, metadata, attributes, text, textMarker };
  }
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
function parseMetadata(state) {
  const attrs = {};
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
function parseAttributeBlock(state, name) {
  consumeChar(state, "{", "UNEXPECTED_TOKEN", "Expected '{' to start attribute block");
  const attrs = {};
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
function parseArrayBody(state, name) {
  consumeChar(state, "[", "UNEXPECTED_TOKEN", "Expected '[' to start array block");
  const items = [];
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
function parseExtendBody(state, name) {
  consumeChar(state, "(", "UNEXPECTED_TOKEN", "Expected '(' to start extend block");
  const children = {};
  const order = [];
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
function parseOptionalId(state) {
  if (!consumeIf(state, "#")) return void 0;
  const word = parseWordLiteral(state);
  skipWhitespaceAndComments(state);
  return word;
}
function parseTextBody(state, name) {
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
      content = content.slice(0, -1);
    }
    state.pos = i + 1;
    return { text: content, textMarker: marker ?? void 0 };
  }
}
function buildExtendBody(nodes, parentName, warnings) {
  const children = {};
  const order = [];
  for (const node of nodes) {
    const element = node;
    if (element.kind !== "DataElement" && element.kind !== "TextElement") continue;
    mergeChild(children, order, element, parentName, warnings);
  }
  return { children, order };
}
function mergeChild(children, order, node, parentName, warnings) {
  if (children[node.tag]) {
    warnings.push({
      code: "DUPLICATE_CHILD",
      message: `Duplicate child '${node.tag}' inside <${parentName} ( ... )> (later node overwrote earlier)`,
      parentName,
      childName: node.tag
    });
    const idx = order.indexOf(node.tag);
    if (idx !== -1) order.splice(idx, 1);
  }
  children[node.tag] = node;
  order.push(node.tag);
}
function parseValueNode(state) {
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
function parseObjectLiteral(state) {
  consumeChar(state, "{", "UNEXPECTED_TOKEN", "Expected '{' to start object literal");
  const entries = {};
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
function parseArrayLiteral(state) {
  consumeChar(state, "[", "UNEXPECTED_TOKEN", "Expected '[' to start array literal");
  const items = [];
  while (true) {
    skipWhitespaceAndComments(state);
    if (consumeIf(state, "]")) break;
    items.push(parseValueNode(state));
    skipWhitespaceAndComments(state);
  }
  return items;
}
function parseStringLiteral(state) {
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
      else if (next === "t") value += "	";
      else if (next === '"') value += '"';
      else if (next === "'") value += "'";
      else value += next;
    } else {
      value += ch;
    }
  }
  throw error(state, "UNEXPECTED_EOF", "Unterminated string literal");
}
function parseNumberLiteral(state) {
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
function parseBooleanLiteral(state) {
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
function parseNullLiteral(state) {
  consumeString(state, "null", "INVALID_LITERAL", "Invalid null literal");
  return null;
}
function parseWordLiteral(state) {
  const first = readIdentifier(state, "Expected identifier literal");
  const parts = [first];
  while (lookAhead(state, ".")) {
    state.pos += 1;
    const next = readIdentifier(state, "Expected identifier segment after '.'");
    parts.push(next);
  }
  const name = parts.pop();
  return { kind: "Word", namespace: parts, name };
}
function readOptionalMarker(state) {
  if (!isMarkerStart(peek(state))) return void 0;
  return readMarker(state);
}
function readMarker(state) {
  const start = state.pos;
  while (!eof(state) && isIdentifierChar(state.input[state.pos])) {
    state.pos++;
  }
  return state.input.slice(start, state.pos);
}
function readKey(state, message) {
  const ch = peek(state);
  if (ch === '"' || ch === "'") {
    return parseStringLiteral(state);
  }
  return readIdentifier(state, message);
}
function readTagName(state) {
  const parts = [readIdentifier(state, "Expected node name")];
  while (lookAhead(state, ".")) {
    state.pos += 1;
    parts.push(readIdentifier(state, "Expected tag segment after '.'"));
  }
  return parts.join(".");
}
function readIdentifier(state, message) {
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
function startsWithNumber(state) {
  const ch = state.input[state.pos];
  if (ch === "+" || ch === "-") {
    const next = peek(state, 1);
    return next !== void 0 && isDigit(next);
  }
  return isDigit(ch);
}
function startsWithBoolean(state) {
  return lookAhead(state, "true") || lookAhead(state, "false");
}
function startsWithNull(state) {
  return lookAhead(state, "null");
}
function consumeIf(state, token) {
  if (lookAhead(state, token)) {
    state.pos += token.length;
    return true;
  }
  return false;
}
function consumeString(state, token, code, message) {
  if (!lookAhead(state, token)) {
    throw error(state, code, message);
  }
  state.pos += token.length;
}
function lookAhead(state, token) {
  return state.input.startsWith(token, state.pos);
}
function consumeChar(state, expected, code, message) {
  const ch = consume(state);
  if (ch !== expected) {
    throw error(state, code, message);
  }
  return ch;
}
function consume(state) {
  if (eof(state)) throw error(state, "UNEXPECTED_EOF", "Unexpected end of input");
  const ch = state.input[state.pos];
  state.pos += 1;
  return ch;
}
function skipWhitespaceAndComments(state) {
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
function indentationBefore(input, index) {
  const lastNewline = input.lastIndexOf("\n", index - 1);
  if (lastNewline === -1) return "";
  const indent = input.slice(lastNewline + 1, index);
  return /^[ \t]*$/.test(indent) ? indent : "";
}
function dedentContent(content, indent) {
  if (!content.includes("\n") || indent === "") return content;
  const lines = content.split("\n");
  const startIndex = lines[0].length === 0 ? 1 : 0;
  const dedented = lines.slice(startIndex).map((line) => {
    let remove = 0;
    while (remove < indent.length && remove < line.length && line[remove] === indent[remove] && (indent[remove] === " " || indent[remove] === "	")) {
      remove++;
    }
    return line.slice(remove);
  });
  return dedented.join("\n");
}
function stripComments(content) {
  return content.replace(/<!--[\\s\\S]*?-->/g, "");
}
function eof(state) {
  return state.pos >= state.length;
}
function peek(state, offset = 0) {
  const idx = state.pos + offset;
  return idx < state.length ? state.input[idx] : void 0;
}
function isIdentifierStart(ch) {
  if (!ch) return false;
  return /[A-Za-z_]/.test(ch);
}
function isIdentifierChar(ch) {
  if (!ch) return false;
  return /[A-Za-z0-9_-]/.test(ch);
}
function isMarkerStart(ch) {
  return isIdentifierStart(ch) || isDigit(ch);
}
function isWhitespace(ch) {
  return ch === " " || ch === "	" || ch === "\n" || ch === "\r";
}
function isDigit(ch) {
  return ch !== void 0 && ch >= "0" && ch <= "9";
}
function error(state, code, message) {
  return new XnlParseError(code, message, state.input, state.pos);
}
function skipComment(state) {
  if (!lookAhead(state, "<!--")) return;
  const end = state.input.indexOf("-->", state.pos + 4);
  if (end === -1) {
    throw error(state, "UNEXPECTED_EOF", "Unterminated comment");
  }
  state.pos = end + 3;
}

// src/types.ts
function isWord(value) {
  return value !== null && typeof value === "object" && value.kind === "Word";
}
function wordToString(word) {
  if (!word) return void 0;
  const ns = word.namespace ?? [];
  const parts = [...ns.filter(Boolean), word.name].filter((p) => p !== void 0 && p !== null);
  const str = parts.join(".");
  return str.length ? str : void 0;
}

// src/formatter.ts
function stringify(value, options = {}) {
  const pretty = options.pretty === true;
  const indent = typeof options.indent === "string" ? options.indent : " ".repeat(options.indent ?? 0);
  const state = { pretty, indent, depth: 0 };
  const separator = pretty ? "\n" : "";
  const content = isDocument(value) ? value.nodes.map((n) => serializeNode(n, state)).join(separator) : serializeNode(value, state);
  return content;
}
function isDocument(value) {
  return value && Array.isArray(value.nodes);
}
function serializeNode(node, state) {
  if (isComment(node)) {
    const pad2 = state.pretty ? state.indent.repeat(state.depth) : "";
    return `${pad2}<!-- ${node.value} -->`;
  }
  if (isElement(node)) {
    const pad2 = state.pretty ? state.indent.repeat(state.depth) : "";
    if (node.kind === "TextElement") {
      const metaStr2 = serializeInlineAttributes(node.metadata, state);
      const attrStr = node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "";
      const idPart2 = node.id ? ` #${formatWord(node.id)}` : "";
      const marker = node.textMarker ?? "";
      return `${pad2}<${node.tag}${idPart2}${metaStr2}${attrStr} ?${marker}>${node.text ?? ""}</?${marker}>`;
    }
    const metaStr = serializeInlineAttributes(node.metadata, state);
    const attrPart = node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "";
    const bodyPart = node.body ? ` ${serializeArrayBlock(node.body, state)}` : "";
    const extendPart = node.extend ? ` ${serializeExtendBlock(node.extend, state)}` : "";
    const idPart = node.id ? ` #${formatWord(node.id)}` : "";
    return `${pad2}<${node.tag}${idPart}${metaStr}${attrPart}${bodyPart}${extendPart}>`;
  }
  if (Array.isArray(node)) {
    return serializeArrayLiteral(node, state);
  }
  if (isPlainObject(node)) {
    return serializeObjectLiteral(node, state);
  }
  return serializePrimitive(node);
}
function serializeInlineAttributes(attrs, state) {
  const parts = [];
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(`${serializeKey(key)}=${serializeValueNode(value, state)}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}
function serializeAttributeBlock(attrs, state) {
  if (!state.pretty) {
    const entries = Object.entries(attrs).map(([k, v]) => `${serializeKey(k)} = ${serializeValueNode(v, state)}`).join(" ");
    return `{ ${entries} }`;
  }
  const nextDepth = state.depth + 1;
  const pad2 = state.indent.repeat(nextDepth);
  const lines = Object.entries(attrs).map(
    ([k, v]) => `${pad2}${serializeKey(k)} = ${serializeValueNode(v, { ...state, depth: nextDepth })}`
  );
  const closingPad = state.indent.repeat(state.depth);
  return `{
${lines.join("\n")}
${closingPad}}`;
}
function serializeArrayBlock(items, state) {
  if (!state.pretty) {
    const serialized = items.map((item) => serializeValueNode(item, state)).join(" ");
    return `[ ${serialized} ]`;
  }
  const nextDepth = state.depth + 1;
  const pad2 = state.indent.repeat(nextDepth);
  const lines = items.map((item) => `${pad2}${serializeValueNode(item, { ...state, depth: nextDepth })}`);
  const closingPad = state.indent.repeat(state.depth);
  return `[
${lines.join("\n")}
${closingPad}]`;
}
function serializeExtendBlock(extend, state) {
  if (!state.pretty) {
    const children = extend.order.map((name) => serializeNode(extend.children[name], state)).join(" ");
    return `( ${children} )`;
  }
  const nextDepth = state.depth + 1;
  const pad2 = state.indent.repeat(nextDepth);
  const childStrings = extend.order.map((name) => `${pad2}${serializeNode(extend.children[name], { ...state, depth: nextDepth })}`);
  const closingPad = state.indent.repeat(state.depth);
  return `(
${childStrings.join("\n")}
${closingPad})`;
}
function serializeValueNode(node, state) {
  if (isComment(node) || isElement(node)) return serializeNode(node, state);
  if (isWord(node)) return formatWord(node);
  if (Array.isArray(node)) return serializeArrayLiteral(node, state);
  if (isPlainObject(node)) return serializeObjectLiteral(node, state);
  return serializePrimitive(node);
}
function serializePrimitive(value) {
  if (value === null) return "null";
  if (typeof value === "string") return `"${escapeString(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
function serializeObjectLiteral(obj, state) {
  if (!state.pretty) {
    return `{ ${Object.entries(obj).map(([k, v]) => `${serializeKey(k)} = ${serializeValueNode(v, state)}`).join(" ")} }`;
  }
  const nextDepth = state.depth + 1;
  const pad2 = state.indent.repeat(nextDepth);
  const lines = Object.entries(obj).map(
    ([k, v]) => `${pad2}${serializeKey(k)} = ${serializeValueNode(v, { ...state, depth: nextDepth })}`
  );
  const closingPad = state.indent.repeat(state.depth);
  return `{
${lines.join("\n")}
${closingPad}}`;
}
function serializeArrayLiteral(arr, state) {
  if (!state.pretty) {
    return `[${arr.map((v) => serializeValueNode(v, state)).join(" ")}]`;
  }
  const nextDepth = state.depth + 1;
  const pad2 = state.indent.repeat(nextDepth);
  const lines = arr.map((v) => `${pad2}${serializeValueNode(v, { ...state, depth: nextDepth })}`);
  const closingPad = state.indent.repeat(state.depth);
  return `[
${lines.join("\n")}
${closingPad}]`;
}
function isComment(node) {
  return typeof node === "object" && node !== null && node.kind === "Comment";
}
function isElement(node) {
  return typeof node === "object" && node !== null && (node.kind === "DataElement" || node.kind === "TextElement");
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === void 0;
}
function serializeKey(key) {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return key;
  return `"${escapeString(key)}"`;
}
function escapeString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
}
function formatWord(word) {
  return wordToString(word) ?? "";
}

// src/lineBlockFormatter.ts
var ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var lastUlidTime = -1;
var lastUlidRandom = [];
function stringify2(value, options = {}) {
  const state = {
    indent: typeof options.indent === "string" ? options.indent : " ".repeat(options.indent ?? 2),
    depth: 0,
    textMarkerFactory: options.textMarkerFactory ?? makeUlid,
    textBlockStyle: options.textBlockStyle ?? false
  };
  if (isDocument2(value)) {
    return value.nodes.map((node) => serializeNode2(node, state)).join("\n");
  }
  return serializeNode2(value, state);
}
function serializeNode2(node, state) {
  if (isComment2(node)) return `${pad(state)}<!-- ${node.value} -->`;
  if (isElement2(node)) return serializeElement(node, state);
  return `${pad(state)}${serializeInlineValue(node, state)}`;
}
function serializeElement(node, state) {
  if (node.kind === "TextElement") return serializeTextElement(node, state);
  return serializeDataElement(node, state);
}
function serializeTextElement(node, state) {
  const marker = node.textMarker ?? state.textMarkerFactory();
  const open = [
    `<${node.tag}`,
    serializeId(node.id),
    serializeMetadata(node.metadata, state),
    node.attributes ? ` ${serializeAttributeBlock2(node.attributes, state)}` : "",
    ` ?${marker}>`
  ].join("");
  const text = node.text ?? "";
  const currentPad = pad(state);
  if (state.textBlockStyle && text !== "") {
    const body = text.split(/\r?\n/).map((line) => line === "" ? "" : `${currentPad}${line}`).join("\n");
    return `${currentPad}${open}
${body}
${currentPad}</?${marker}>`;
  }
  const alignedText = text.replace(/\r?\n/g, (lineBreak) => `${lineBreak}${currentPad}`);
  return `${currentPad}${open}${alignedText}</?${marker}>`;
}
function serializeDataElement(node, state) {
  const open = [
    `<${node.tag}`,
    serializeId(node.id),
    serializeMetadata(node.metadata, state),
    node.attributes ? ` ${serializeAttributeBlock2(node.attributes, state)}` : ""
  ].join("");
  const sections = [];
  if (node.body) sections.push(serializeArrayBlock2(node.body, state));
  if (node.extend) sections.push(serializeExtendBlock2(node.extend, state));
  if (sections.length === 0) return `${pad(state)}${open}>`;
  if (sections.length === 1) return `${pad(state)}${open} ${sections[0]}>`;
  return `${pad(state)}${open} ${sections.join(" ")}>`;
}
function serializeArrayBlock2(items, state) {
  if (items.length === 0) return "[]";
  const nextState = { ...state, depth: state.depth + 1 };
  const lines = items.map((item) => serializeNode2(item, nextState));
  return `[
${lines.join("\n")}
${pad(state)}]`;
}
function serializeExtendBlock2(extend, state) {
  if (extend.order.length === 0) return "()";
  const nextState = { ...state, depth: state.depth + 1 };
  const lines = extend.order.map((name) => serializeElement(extend.children[name], nextState));
  return `(
${lines.join("\n")}
${pad(state)})`;
}
function serializeMetadata(attrs, state) {
  const entries = Object.entries(attrs);
  if (entries.length === 0) return "";
  return " " + entries.map(([key, value]) => `${serializeKey2(key)}=${serializeInlineValue(value, state)}`).join(" ");
}
function serializeAttributeBlock2(attrs, state) {
  const entries = Object.entries(attrs).map(([key, value]) => `${serializeKey2(key)} = ${serializeInlineValue(value, state)}`).join(" ");
  return `{ ${entries} }`;
}
function serializeInlineValue(value, state) {
  if (isComment2(value)) return `<!-- ${value.value} -->`;
  if (isElement2(value)) return serializeInlineElement(value, state);
  if (isWord(value)) return formatWord2(value);
  if (Array.isArray(value)) return serializeInlineArray(value, state);
  if (isPlainObject2(value)) return serializeInlineObject(value, state);
  return serializePrimitive2(value);
}
function serializeInlineElement(node, state) {
  const marker = node.kind === "TextElement" ? node.textMarker ?? state.textMarkerFactory() : void 0;
  const open = [
    `<${node.tag}`,
    serializeId(node.id),
    serializeMetadata(node.metadata, state),
    node.attributes ? ` ${serializeAttributeBlock2(node.attributes, state)}` : ""
  ].join("");
  if (node.kind === "TextElement") return `${open} ?${marker}>${node.text ?? ""}</?${marker}>`;
  const sections = [];
  if (node.body) sections.push(serializeInlineArrayBlock(node.body, state));
  if (node.extend) sections.push(serializeInlineExtendBlock(node.extend, state));
  if (sections.length === 0) return `${open}>`;
  return `${open} ${sections.join(" ")}>`;
}
function serializeInlineArrayBlock(items, state) {
  return `[ ${items.map((item) => serializeInlineValue(item, state)).join(" ")} ]`;
}
function serializeInlineExtendBlock(extend, state) {
  return `( ${extend.order.map((name) => serializeInlineElement(extend.children[name], state)).join(" ")} )`;
}
function serializeInlineObject(value, state) {
  const entries = Object.entries(value).map(([key, child]) => `${serializeKey2(key)} = ${serializeInlineValue(child, state)}`).join(" ");
  return `{ ${entries} }`;
}
function serializeInlineArray(value, state) {
  return `[${value.map((child) => serializeInlineValue(child, state)).join(" ")}]`;
}
function serializePrimitive2(value) {
  if (value === null) return "null";
  if (typeof value === "string") return `"${escapeString2(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
function serializeId(id) {
  const value = formatWord2(id);
  return value ? ` #${value}` : "";
}
function formatWord2(word) {
  return wordToString(word) ?? "";
}
function serializeKey2(key) {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return key;
  return `"${escapeString2(key)}"`;
}
function escapeString2(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
}
function pad(state) {
  return state.indent.repeat(state.depth);
}
function isDocument2(value) {
  return value && Array.isArray(value.nodes);
}
function isElement2(value) {
  return typeof value === "object" && value !== null && (value.kind === "DataElement" || value.kind === "TextElement");
}
function isComment2(value) {
  return typeof value === "object" && value !== null && value.kind === "Comment";
}
function isPlainObject2(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const kind = value.kind;
  return kind !== "DataElement" && kind !== "TextElement" && kind !== "Comment" && kind !== "Word";
}
function makeUlid(now = Date.now()) {
  if (now > lastUlidTime) {
    lastUlidTime = now;
    lastUlidRandom = nextRandom();
  } else {
    lastUlidRandom = incrementRandom(lastUlidRandom);
  }
  return encodeTime(lastUlidTime, 10) + encodeRandom(lastUlidRandom);
}
function encodeTime(time, length) {
  let out = "";
  for (let index = length - 1; index >= 0; index--) {
    out = ULID_ENCODING.charAt(time % 32) + out;
    time = Math.floor(time / 32);
  }
  return out;
}
function encodeRandom(values) {
  return values.map((value) => ULID_ENCODING.charAt(value)).join("");
}
function nextRandom() {
  return Array.from({ length: 16 }, () => Math.random() * 32 | 0);
}
function incrementRandom(values) {
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

// src/path/index.ts
var XnlPathError = class extends Error {
};
function parsePath(input) {
  if (!input) return [];
  const items = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    const next = input[i + 1];
    if (c === "#") {
      i += 1;
      const { value, length } = readWordToken(input, i);
      items.push({ type: "UniqueName", value });
      i += length;
      continue;
    }
    if (c === "<") {
      const parsed = parseMetadataSelector(input, i);
      items.push(parsed.item);
      i = parsed.nextIndex;
      continue;
    }
    if (c === ":" && next === ":") {
      i += 2;
      if (input[i] === "'") {
        i += 1;
        const end = input.indexOf("'", i);
        if (end === -1) throw new XnlPathError("Unterminated map key literal");
        const key = input.slice(i, end);
        items.push({ type: "MapKey", value: key });
        i = end + 1;
      } else {
        const digits = readWhile(input, i, (ch) => /[0-9]/.test(ch));
        if (!digits) throw new XnlPathError("ListIndex must be numeric");
        items.push({ type: "ListIndex", value: digits });
        i += digits.length;
      }
      continue;
    }
    if (c === ":") {
      i += 1;
      const value = readUntilDelimiter(input, i);
      if (!value) throw new XnlPathError("InstanceProperty cannot be empty");
      items.push({ type: "InstanceProperty", value });
      i += value.length;
      continue;
    }
    if (c === ".") {
      throw new XnlPathError("Namespace/static segments are not supported for XNL paths");
    }
    throw new XnlPathError(`Unexpected character '${c}' at position ${i}`);
  }
  return items;
}
function resolvePath(target, path, options = {}) {
  const { strict = true, metadataIdMode } = options;
  const parsed = Array.isArray(path) ? path : parsePath(path);
  let current = target;
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (item.type === "UniqueName") {
      const found = findByUniqueName(target, item.value);
      if (!found) {
        if (strict) throw new XnlPathError(`UniqueName '${item.value}' not found`);
        return void 0;
      }
      current = found;
      continue;
    }
    if (item.type === "MetadataSelector") {
      const isLast = i === parsed.length - 1;
      if (metadataIdMode === "identity") {
        const selector = parseMetadataSelectorValue(item.value);
        const found = selector.key === "id" ? findByUniqueName(target, selector.value) ?? findByMetadataSelector(target, item.value) : findByMetadataSelector(target, item.value);
        if (!found) {
          if (strict) throw new XnlPathError(`MetadataSelector '${item.value}' not found`);
          return void 0;
        }
        current = found;
        continue;
      }
      const allFound = findAllByMetadataSelector(target, item.value);
      if (allFound.length === 0) {
        if (strict) throw new XnlPathError(`MetadataSelector '${item.value}' not found`);
        return void 0;
      }
      current = isLast ? allFound : allFound[0];
      continue;
    }
    if (item.type === "InstanceProperty") {
      if (current && isDataElement(current)) {
        current = current[item.value];
      } else if (current && isTextElement(current)) {
        current = current[item.value];
      } else if (isPlainObject3(current) || isDocument3(current)) {
        current = current[item.value];
      } else {
        if (strict) throw new XnlPathError(`InstanceProperty '${item.value}' not allowed on current node`);
        return void 0;
      }
      if (current === void 0 && strict) {
        throw new XnlPathError(`InstanceProperty '${item.value}' not found`);
      }
      continue;
    }
    if (item.type === "MapKey") {
      if (isExtendBody(current)) {
        const child = current.children[item.value];
        if (!child && strict) throw new XnlPathError(`Extend child '${item.value}' not found`);
        current = child;
        continue;
      }
      if (!isPlainObject3(current)) {
        if (strict) throw new XnlPathError("MapKey requires a map/object target");
        return void 0;
      }
      if (!(item.value in current) && strict) {
        throw new XnlPathError(`Key '${item.value}' not found`);
      }
      current = current[item.value];
      continue;
    }
    if (item.type === "ListIndex") {
      const index = Number(item.value);
      if (isExtendBody(current)) {
        const tag = current.order[index];
        if (tag === void 0) {
          if (strict) throw new XnlPathError(`Extend index ${index} out of bounds`);
          return void 0;
        }
        current = current.children[tag];
        continue;
      }
      if (!Array.isArray(current)) {
        if (strict) throw new XnlPathError("ListIndex requires an array target");
        return void 0;
      }
      if (index < 0 || index >= current.length) {
        if (strict) throw new XnlPathError(`Index ${index} out of bounds`);
        return void 0;
      }
      current = current[index];
    }
  }
  return current;
}
function setPathValue(target, path, value, options = {}) {
  const { mode = "insert", strict = true } = options;
  const parsed = Array.isArray(path) ? path : parsePath(path);
  if (parsed.length === 0) {
    return value;
  }
  const { parent, last } = getParentAndLast(target, parsed, { strict, createMissing: true });
  switch (last.type) {
    case "InstanceProperty":
      parent[last.value] = value;
      return target;
    case "MapKey":
      if (isExtendBody(parent)) {
        parent.children[last.value] = value;
        if (!parent.order.includes(last.value)) {
          parent.order.push(last.value);
        }
        return target;
      }
      ensureMap(parent, strict);
      parent[last.value] = value;
      return target;
    case "ListIndex": {
      const idx = Number(last.value);
      if (isExtendBody(parent)) {
        const key = options.destinationKey ?? value?.tag ?? String(idx);
        if (mode === "insert") {
          parent.order.splice(idx, 0, key);
          parent.children[key] = value;
        } else {
          const tag = parent.order[idx];
          if (tag === void 0 && strict) {
            throw new XnlPathError(`Extend index ${idx} out of bounds`);
          }
          const useTag = options.destinationKey ?? value?.tag ?? tag;
          parent.order[idx] = useTag;
          parent.children[useTag] = value;
        }
        return target;
      }
      if (!Array.isArray(parent)) {
        throw new XnlPathError("ListIndex requires an array target");
      }
      if (mode === "insert") {
        const insertAt = idx < 0 ? 0 : idx > parent.length ? parent.length : idx;
        parent.splice(insertAt, 0, value);
      } else {
        if (idx < 0 || idx >= parent.length) {
          throw new XnlPathError(`Index ${idx} out of bounds for replace`);
        }
        parent[idx] = value;
      }
      return target;
    }
    default:
      throw new XnlPathError(`Unsupported path item ${last.type}`);
  }
}
function deleteAtPath(target, path, options = {}) {
  const { strict = true } = options;
  const parsed = Array.isArray(path) ? path : parsePath(path);
  if (parsed.length === 0) return void 0;
  const { parent, last } = getParentAndLast(target, parsed, { strict, createMissing: false });
  switch (last.type) {
    case "InstanceProperty":
      if (isPlainObject3(parent) || isDataElement(parent) || isTextElement(parent) || isDocument3(parent)) {
        if (!(last.value in parent) && strict) {
          throw new XnlPathError(`InstanceProperty '${last.value}' not found`);
        }
        delete parent[last.value];
        return target;
      }
      throw new XnlPathError("InstanceProperty delete requires an object-like target");
    case "MapKey":
      if (isExtendBody(parent)) {
        if (!(last.value in parent.children) && strict) {
          throw new XnlPathError(`Extend child '${last.value}' not found`);
        }
        delete parent.children[last.value];
        parent.order = parent.order.filter((t) => t !== last.value);
        return target;
      }
      ensureMap(parent, strict);
      delete parent[last.value];
      return target;
    case "ListIndex": {
      const idx = Number(last.value);
      if (isExtendBody(parent)) {
        if (idx < 0 || idx >= parent.order.length) {
          if (strict) throw new XnlPathError(`Extend index ${idx} out of bounds`);
          return target;
        }
        const tag = parent.order[idx];
        parent.order.splice(idx, 1);
        delete parent.children[tag];
        return target;
      }
      if (!Array.isArray(parent)) throw new XnlPathError("ListIndex delete requires an array target");
      if (idx < 0 || idx >= parent.length) {
        if (strict) throw new XnlPathError(`Index ${idx} out of bounds`);
        return target;
      }
      parent.splice(idx, 1);
      return target;
    }
    default:
      throw new XnlPathError(`Unsupported path item ${last.type}`);
  }
}
function getParentAndLast(target, path, opts) {
  if (path.length === 0) throw new XnlPathError("Path is empty");
  const { createMissing, strict = true } = opts;
  const parentPath2 = path.slice(0, -1);
  const last = path[path.length - 1];
  let current = target;
  for (const item of parentPath2) {
    if (item.type === "UniqueName") {
      const found = findByUniqueName(target, item.value);
      if (!found) {
        if (strict) throw new XnlPathError(`UniqueName '${item.value}' not found`);
        return { parent: void 0, last };
      }
      current = found;
      continue;
    }
    if (item.type === "MetadataSelector") {
      const selector = parseMetadataSelectorValue(item.value);
      const found = selector.key === "id" ? findByUniqueName(target, selector.value) ?? findByMetadataSelector(target, item.value) : findByMetadataSelector(target, item.value);
      if (!found) {
        if (strict) throw new XnlPathError(`MetadataSelector '${item.value}' not found`);
        return { parent: void 0, last };
      }
      current = found;
      continue;
    }
    if (item.type === "InstanceProperty") {
      if (current && isDataElement(current)) {
        if (current[item.value] === void 0 && createMissing) {
          if (item.value === "metadata" || item.value === "attributes") {
            current[item.value] = {};
          } else if (item.value === "body") {
            current[item.value] = [];
          } else if (item.value === "extend") {
            current[item.value] = { order: [], children: {} };
          }
        }
        current = current[item.value];
      } else if (current && isTextElement(current)) {
        current = current[item.value];
      } else if (isPlainObject3(current) || isDocument3(current)) {
        if (current[item.value] === void 0 && createMissing && isPlainObject3(current)) {
          current[item.value] = {};
        }
        current = current[item.value];
      } else {
        throw new XnlPathError(`InstanceProperty '${item.value}' not allowed on current node`);
      }
      if (current === void 0 && strict) {
        throw new XnlPathError(`InstanceProperty '${item.value}' not found`);
      }
      continue;
    }
    if (item.type === "MapKey") {
      if (isExtendBody(current)) {
        const child = current.children[item.value];
        if (!child && createMissing) {
          current.children[item.value] = void 0;
          if (!current.order.includes(item.value)) {
            current.order.push(item.value);
          }
        }
        current = current.children[item.value];
        if (current === void 0 && strict && !createMissing) {
          throw new XnlPathError(`Extend child '${item.value}' not found`);
        }
        continue;
      }
      ensureMap(current, strict);
      if (!(item.value in current) && createMissing) {
        current[item.value] = {};
      }
      current = current[item.value];
      if (current === void 0 && strict && !createMissing) {
        throw new XnlPathError(`Key '${item.value}' not found`);
      }
      continue;
    }
    if (item.type === "ListIndex") {
      const idx = Number(item.value);
      if (isExtendBody(current)) {
        if (idx < 0 || idx > current.order.length) {
          throw new XnlPathError(`Extend index ${idx} out of bounds`);
        }
        const tag = current.order[idx];
        if (!tag && createMissing) {
          const placeholder = String(idx);
          current.order[idx] = placeholder;
          current.children[placeholder] = void 0;
          current = current.children[placeholder];
        } else {
          if (tag === void 0 && strict) {
            throw new XnlPathError(`Extend index ${idx} out of bounds`);
          }
          current = current.children[tag];
        }
        continue;
      }
      if (!Array.isArray(current)) {
        if (!strict && !current) return { parent: void 0, last };
        throw new XnlPathError("ListIndex requires an array target");
      }
      if (idx < 0 || idx > current.length) {
        throw new XnlPathError(`Index ${idx} out of bounds`);
      }
      if (createMissing && idx === current.length) {
        current.push(void 0);
      }
      current = current[idx];
      continue;
    }
  }
  return { parent: current, last };
}
function readUntilDelimiter(input, start) {
  let i = start;
  let value = "";
  while (i < input.length) {
    const c = input[i];
    if (c === ":" || c === "#" || c === "." || c === "<") break;
    value += c;
    i++;
  }
  return value;
}
function readWordToken(input, start) {
  let i = start;
  let value = "";
  while (i < input.length) {
    const c = input[i];
    if (c === ":" || c === "#") break;
    value += c;
    i++;
  }
  if (!value) throw new XnlPathError("UniqueName cannot be empty");
  const segments = value.split(".");
  for (const segment of segments) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment)) {
      throw new XnlPathError("UniqueName must use word identifiers (letters/digits/_/- with dots for namespace)");
    }
  }
  return { value, length: value.length };
}
function readWhile(input, start, pred) {
  let i = start;
  let out = "";
  while (i < input.length && pred(input[i])) {
    out += input[i];
    i++;
  }
  return out;
}
function findByUniqueName(target, id) {
  const roots = isDocument3(target) ? target.nodes : [target];
  for (const root of roots) {
    const found = findInNode(root, id);
    if (found) return found;
  }
  return void 0;
}
function findByMetadataSelector(target, selector) {
  const parsed = parseMetadataSelectorValue(selector);
  const roots = isDocument3(target) ? target.nodes : [target];
  for (const root of roots) {
    const found = findInNodeByMeta(root, parsed.key, parsed.value);
    if (found) return found;
  }
  return void 0;
}
function findAllByMetadataSelector(target, selector) {
  const parsed = parseMetadataSelectorValue(selector);
  const roots = isDocument3(target) ? target.nodes : [target];
  const out = [];
  for (const root of roots) {
    collectInNodeByMeta(root, parsed.key, parsed.value, out);
  }
  return out;
}
function findInNodeByMeta(node, key, value) {
  if (isElementNode(node)) {
    const meta = node.metadata;
    const raw = meta ? meta[key] : void 0;
    const rawStr = typeof raw === "string" ? raw : isWord(raw) ? wordToString(raw) : void 0;
    if (rawStr === value) return node;
    if (node.kind === "DataElement") {
      if (node.body) {
        for (const child of node.body) {
          const found = findInNodeByMeta(child, key, value);
          if (found) return found;
        }
      }
      if (node.extend) {
        for (const tag of node.extend.order) {
          const child = node.extend.children[tag];
          if (!child) continue;
          const found = findInNodeByMeta(child, key, value);
          if (found) return found;
        }
      }
    }
    return void 0;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findInNodeByMeta(child, key, value);
      if (found) return found;
    }
  } else if (isPlainObject3(node)) {
    for (const k of Object.keys(node)) {
      const found = findInNodeByMeta(node[k], key, value);
      if (found) return found;
    }
  }
  return void 0;
}
function collectInNodeByMeta(node, key, value, out) {
  if (isElementNode(node)) {
    const meta = node.metadata;
    const raw = meta ? meta[key] : void 0;
    const rawStr = typeof raw === "string" ? raw : isWord(raw) ? wordToString(raw) : void 0;
    if (rawStr === value) out.push(node);
    if (node.kind === "DataElement") {
      if (node.body) {
        for (const child of node.body) {
          collectInNodeByMeta(child, key, value, out);
        }
      }
      if (node.extend) {
        for (const tag of node.extend.order) {
          const child = node.extend.children[tag];
          if (!child) continue;
          collectInNodeByMeta(child, key, value, out);
        }
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectInNodeByMeta(child, key, value, out);
    }
  } else if (isPlainObject3(node)) {
    for (const k of Object.keys(node)) {
      collectInNodeByMeta(node[k], key, value, out);
    }
  }
}
function parseMetadataSelectorValue(selector) {
  const m = selector.match(/^<([A-Za-z_][A-Za-z0-9_-]*)=("([^"]*)"|'([^']*)')>$/);
  if (!m) throw new XnlPathError("Invalid metadata selector");
  const key = m[1];
  const value = m[3] ?? m[4] ?? "";
  return { key, value };
}
function parseMetadataSelector(input, start) {
  if (input[start] !== "<") throw new XnlPathError("Metadata selector must start with '<'");
  const end = input.indexOf(">", start);
  if (end === -1) throw new XnlPathError("Unterminated metadata selector");
  const raw = input.slice(start, end + 1);
  parseMetadataSelectorValue(raw);
  return { item: { type: "MetadataSelector", value: raw }, nextIndex: end + 1 };
}
function findInNode(node, id) {
  if (isElementNode(node)) {
    if (readId(node) === id) return node;
    if (node.kind === "DataElement") {
      if (node.body) {
        for (const child of node.body) {
          const found = findInNode(child, id);
          if (found) return found;
        }
      }
      if (node.extend) {
        for (const tag of node.extend.order) {
          const child = node.extend.children[tag];
          if (!child) continue;
          const found = findInNode(child, id);
          if (found) return found;
        }
      }
    }
    return void 0;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findInNode(child, id);
      if (found) return found;
    }
  } else if (isPlainObject3(node)) {
    for (const key of Object.keys(node)) {
      const found = findInNode(node[key], id);
      if (found) return found;
    }
  }
  return void 0;
}
function isElementNode(node) {
  return node && (node.kind === "DataElement" || node.kind === "TextElement");
}
function isDataElement(node) {
  return node && node.kind === "DataElement";
}
function isTextElement(node) {
  return node && node.kind === "TextElement";
}
function isExtendBody(value) {
  return value && typeof value === "object" && Array.isArray(value.order) && value.children;
}
function isDocument3(value) {
  return value && typeof value === "object" && Array.isArray(value.nodes);
}
function isPlainObject3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isElementNode(value) && !isExtendBody(value) && !isWord(value);
}
function ensureMap(value, strict) {
  if (!isPlainObject3(value)) {
    if (strict) throw new XnlPathError("Target is not a map/object");
  }
}
function readId(node) {
  if (!node) return void 0;
  const idValue = node.id;
  const wordStr = wordToString(idValue);
  if (wordStr) return wordStr;
  const metaId = node.metadata?.id;
  if (isWord(metaId)) return wordToString(metaId);
  if (typeof metaId === "string") return metaId;
  return void 0;
}

// src/mutation/index.ts
function resolveMetaIdMode(opts) {
  return opts.metadataIdMode ?? "identity";
}
function isMetadataIdPath(path) {
  const n = path.length;
  return n >= 2 && path[n - 2]?.type === "InstanceProperty" && path[n - 2]?.value === "metadata" && path[n - 1]?.type === "MapKey" && path[n - 1]?.value === "id";
}
function isMetadataMapPath(path) {
  const last = path[path.length - 1];
  return last?.type === "InstanceProperty" && last.value === "metadata";
}
function cloneValue(value) {
  return structuredClone(value);
}
function validateIdentities(root, policy) {
  const diagnostics = [];
  const identities = /* @__PURE__ */ new Set();
  const ancestors = /* @__PURE__ */ new WeakSet();
  const visit = (value) => {
    if (value === null || typeof value !== "object") return;
    const objectValue = value;
    if (ancestors.has(objectValue)) return;
    ancestors.add(objectValue);
    if (isDataElement2(value) || isTextElement2(value)) {
      const identity = readIdOrMetadaataId(value);
      if (identity) {
        if (identities.has(identity)) {
          diagnostics.push({
            code: "DUPLICATE_IDENTITY",
            message: `Effective identity '${identity}' appears more than once`,
            identity
          });
        } else {
          identities.add(identity);
        }
      } else if (policy === "require-elements") {
        diagnostics.push({
          code: "MISSING_IDENTITY",
          message: `${value.kind} '${value.tag}' is missing an effective identity`
        });
      }
    }
    for (const key of Object.keys(value)) {
      visit(value[key]);
    }
    ancestors.delete(objectValue);
  };
  visit(root);
  return diagnostics;
}
function readIdentityDescriptor(node) {
  if (!isDataElement2(node) && !isTextElement2(node)) return void 0;
  const explicitId = wordToString(node.id);
  if (explicitId) return { authority: "explicit-id", value: explicitId };
  const metaId = node.metadata?.id;
  const fallback = typeof metaId === "string" ? metaId : isWord(metaId) ? wordToString(metaId) : void 0;
  return fallback ? { authority: "metadata-fallback", value: fallback } : void 0;
}
function collectIdentitySkeleton(root) {
  const entries = [];
  const ancestors = /* @__PURE__ */ new WeakSet();
  const visit = (value, path) => {
    if (value === null || typeof value !== "object") return;
    const objectValue = value;
    if (ancestors.has(objectValue)) return;
    ancestors.add(objectValue);
    const descriptor = readIdentityDescriptor(value);
    if (descriptor) {
      entries.push({ path, descriptor });
    }
    if (isDataElement2(value) || isTextElement2(value)) {
      visitPlainMap(value.metadata, `${path}:metadata`);
      if (value.attributes !== void 0) visitPlainMap(value.attributes, `${path}:attributes`);
      if (isDataElement2(value)) {
        if (value.body !== void 0) visitArray(value.body, `${path}:body`);
        if (value.extend !== void 0) visitExtend(value.extend, `${path}:extend`);
      }
    } else if (Array.isArray(value)) {
      visitArray(value, path);
    } else if (isPlainObject4(value)) {
      visitPlainMap(value, path);
    }
    ancestors.delete(objectValue);
  };
  const visitArray = (values, path) => {
    values.forEach((item, index) => visit(item, `${path}[${index}]`));
  };
  const visitPlainMap = (map, path) => {
    for (const key of Object.keys(map).sort()) {
      visit(map[key], `${path}{${key}}`);
    }
  };
  const visitExtend = (extend, path) => {
    extend.order.forEach((tag, index) => {
      visit(extend.children[tag], `${path}[${index}:${tag}]`);
    });
  };
  visit(root, "$");
  return entries;
}
function identitySkeletonsEqual(before, after) {
  return before.length === after.length && before.every((entry, index) => {
    const other = after[index];
    return other !== void 0 && entry.path === other.path && entry.descriptor.authority === other.descriptor.authority && entry.descriptor.value === other.descriptor.value;
  });
}
function isUpdateMutation(mutation) {
  return mutation.type === "TREE_UPDATE" || mutation.type === "OBJECT_UPDATE";
}
function resolveEffectiveMetadataIdTarget(root, path) {
  if (!isMetadataIdPath(path)) return void 0;
  const elementPath = path.slice(0, -2);
  const candidate = elementPath.length === 0 ? root : resolvePath(root, elementPath, { strict: false, metadataIdMode: "identity" });
  if (!isDataElement2(candidate) && !isTextElement2(candidate)) return void 0;
  return wordToString(candidate.id) ? void 0 : candidate;
}
function containsIdentifiedElement(value) {
  const ancestors = /* @__PURE__ */ new WeakSet();
  const visit = (candidate) => {
    if (candidate === null || typeof candidate !== "object") return false;
    const objectValue = candidate;
    if (ancestors.has(objectValue)) return false;
    ancestors.add(objectValue);
    if (readIdentityDescriptor(candidate)) {
      ancestors.delete(objectValue);
      return true;
    }
    if (isDataElement2(candidate) || isTextElement2(candidate)) {
      if (visit(candidate.metadata) || visit(candidate.attributes)) {
        ancestors.delete(objectValue);
        return true;
      }
      if (isDataElement2(candidate) && (visit(candidate.body) || visit(candidate.extend))) {
        ancestors.delete(objectValue);
        return true;
      }
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (visit(item)) {
          ancestors.delete(objectValue);
          return true;
        }
      }
    } else if (isExtendBody2(candidate)) {
      for (const tag of candidate.order) {
        if (visit(candidate.children[tag])) {
          ancestors.delete(objectValue);
          return true;
        }
      }
    } else if (isPlainObject4(candidate)) {
      for (const key of Object.keys(candidate)) {
        if (visit(candidate[key])) {
          ancestors.delete(objectValue);
          return true;
        }
      }
    }
    ancestors.delete(objectValue);
    return false;
  };
  return visit(value);
}
function resolveMoveSource(root, mutation) {
  if (!isMoveMutation(mutation)) return void 0;
  if (mutation.targetUniqueName) {
    return resolvePath(root, [{ type: "UniqueName", value: mutation.targetUniqueName }], {
      strict: false,
      metadataIdMode: "identity"
    });
  }
  if (mutation.pathBefore) {
    return resolvePath(root, mutation.pathBefore, { strict: false, metadataIdMode: "identity" });
  }
  return void 0;
}
function tagOf(value) {
  return isDataElement2(value) || isTextElement2(value) ? value.tag : void 0;
}
function resolveOccupiedDestination(root, mutation, path, valueAfter) {
  const last = path[path.length - 1];
  if (!last) return void 0;
  const parent = resolvePath(root, path.slice(0, -1), { strict: false, metadataIdMode: "identity" });
  if (parent === void 0) return void 0;
  if (last.type === "ListIndex") {
    if (isExtendBody2(parent)) {
      const key = mutation.destinationKey ?? tagOf(valueAfter);
      return key ? parent.children[key] : void 0;
    }
    return void 0;
  }
  if (last.type === "MapKey") {
    return isExtendBody2(parent) ? parent.children[mutation.destinationKey ?? last.value] : parent[last.value];
  }
  if (last.type === "InstanceProperty") {
    return parent[last.value];
  }
  return void 0;
}
function validateStructuralDestination(root, mutation, path, mutationIndex, originalPath) {
  if (mutation.type !== "TREE_ADD" && mutation.type !== "OBJECT_ADD" && !isMoveMutation(mutation)) {
    return void 0;
  }
  const valueAfter = isMoveMutation(mutation) ? resolveMoveSource(root, mutation) : mutation.valueAfter;
  const occupied = resolveOccupiedDestination(root, mutation, path, valueAfter);
  if (occupied === void 0 || occupied === valueAfter || !containsIdentifiedElement(occupied)) {
    return void 0;
  }
  return {
    code: "IDENTITY_MUTATION_FORBIDDEN",
    message: "Strict structural mutations cannot overwrite an occupied identified destination",
    mutationIndex,
    path: originalPath,
    identity: readIdOrMetadaataId(occupied)
  };
}
function validateExtendCoherence(root) {
  const diagnostics = [];
  const ancestors = /* @__PURE__ */ new WeakSet();
  const visit = (value) => {
    if (value === null || typeof value !== "object") return;
    const objectValue = value;
    if (ancestors.has(objectValue)) return;
    ancestors.add(objectValue);
    if (isExtendBody2(value)) {
      const orderSet = new Set(value.order);
      const childKeys = Object.keys(value.children);
      if (orderSet.size !== value.order.length || orderSet.size !== childKeys.length) {
        diagnostics.push({
          code: "RESULT_STRUCTURE_INVALID",
          message: "Extend order and child keys must be unique and coherent"
        });
      }
      for (const key of childKeys) {
        const child = value.children[key];
        if (!orderSet.has(key) || !child || child.tag !== key) {
          diagnostics.push({
            code: "RESULT_STRUCTURE_INVALID",
            message: `Extend child '${key}' is not coherent with order/key/tag storage`,
            identity: readIdOrMetadaataId(child)
          });
        }
      }
      for (const tag of value.order) {
        visit(value.children[tag]);
      }
    } else if (isDataElement2(value) || isTextElement2(value)) {
      visit(value.metadata);
      visit(value.attributes);
      if (isDataElement2(value)) {
        visit(value.body);
        visit(value.extend);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (isPlainObject4(value)) {
      for (const key of Object.keys(value)) visit(value[key]);
    }
    ancestors.delete(objectValue);
  };
  visit(root);
  return diagnostics;
}
function isAddUpdateOrDelete(mutation) {
  return mutation.type === "TREE_ADD" || mutation.type === "TREE_DELETE" || mutation.type === "TREE_UPDATE" || mutation.type === "OBJECT_ADD" || mutation.type === "OBJECT_DELETE" || mutation.type === "OBJECT_UPDATE";
}
function resolveDirectElementIdTarget(root, mutation, path) {
  if (!isAddUpdateOrDelete(mutation)) return void 0;
  const last = path[path.length - 1];
  if (last?.type !== "InstanceProperty" || last.value !== "id") return void 0;
  const parentPath2 = path.slice(0, -1);
  const parent = parentPath2.length === 0 ? root : resolvePath(root, parentPath2, { strict: false, metadataIdMode: "identity" });
  return isDataElement2(parent) || isTextElement2(parent) ? parent : void 0;
}
function isMoveMutation(mutation) {
  return mutation.type === "TREE_MOVE" || mutation.type === "TREE_MOVE_SAME_LEVEL" || mutation.type === "TREE_MOVE_CROSS_LEVEL";
}
function supportsValueBefore(mutation) {
  return isMoveMutation(mutation) || mutation.type === "TREE_DELETE" || mutation.type === "TREE_UPDATE" || mutation.type === "OBJECT_DELETE" || mutation.type === "OBJECT_UPDATE";
}
function resolveObservableTarget(root, mutation, path) {
  if (isMoveMutation(mutation)) {
    if (mutation.targetUniqueName) {
      const target = resolvePath(
        root,
        [{ type: "UniqueName", value: mutation.targetUniqueName }],
        { strict: false, metadataIdMode: "identity" }
      );
      if (target !== void 0) return target;
    }
    if (mutation.pathBefore) {
      return resolvePath(root, mutation.pathBefore, { strict: false, metadataIdMode: "identity" });
    }
    return void 0;
  }
  return resolvePath(root, path, { strict: false, metadataIdMode: "identity" });
}
function isStructurallyEqual(left, right, seen = /* @__PURE__ */ new WeakMap()) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  let rightValues = seen.get(left);
  if (rightValues?.has(right)) return true;
  if (!rightValues) {
    rightValues = /* @__PURE__ */ new WeakSet();
    seen.set(left, rightValues);
  }
  rightValues.add(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => isStructurallyEqual(value, right[index], seen));
  }
  const leftRecord = left;
  const rightRecord = right;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && isStructurallyEqual(leftRecord[key], rightRecord[key], seen)
  );
}
function errorMessage(error2) {
  return error2 instanceof Error ? error2.message : String(error2);
}
var dryRunMutations = (base, mutations, options = {}) => {
  const rejectedValue = cloneValue(base);
  const reject = (diagnostics) => ({
    status: "rejected",
    value: rejectedValue,
    mutations,
    diagnostics
  });
  let baseIdentityDiagnostics;
  try {
    baseIdentityDiagnostics = validateIdentities(
      rejectedValue,
      options.identityPolicy ?? "allow-missing"
    );
  } catch (error2) {
    return reject([
      {
        code: "APPLY_FAILED",
        message: `Base identity validation failed: ${errorMessage(error2)}`
      }
    ]);
  }
  if (baseIdentityDiagnostics.length > 0) {
    return reject(baseIdentityDiagnostics);
  }
  let current;
  let mutationCopies;
  try {
    current = cloneValue(rejectedValue);
    mutationCopies = cloneValue(mutations);
  } catch (error2) {
    return reject([
      {
        code: "APPLY_FAILED",
        message: `Failed to isolate mutation batch: ${errorMessage(error2)}`
      }
    ]);
  }
  for (let mutationIndex = 0; mutationIndex < mutationCopies.length; mutationIndex++) {
    const mutation = mutationCopies[mutationIndex];
    try {
      const path = Array.isArray(mutation.path) ? mutation.path : parsePath(mutation.path);
      const identityTarget = resolveDirectElementIdTarget(current, mutation, path);
      if (identityTarget) {
        return reject([
          {
            code: "IDENTITY_MUTATION_FORBIDDEN",
            message: "Strict mutation batches cannot add, update, or delete an element id field",
            mutationIndex,
            path: mutations[mutationIndex]?.path ?? mutation.path,
            identity: readIdOrMetadaataId(identityTarget)
          }
        ]);
      }
      const metadataFallbackTarget = resolveMetaIdMode(options) === "identity" ? resolveEffectiveMetadataIdTarget(current, path) : void 0;
      if (metadataFallbackTarget && isAddUpdateOrDelete(mutation)) {
        return reject([
          {
            code: "IDENTITY_MUTATION_FORBIDDEN",
            message: "Strict mutation batches cannot directly mutate an effective metadata fallback id",
            mutationIndex,
            path: mutations[mutationIndex]?.path ?? mutation.path,
            identity: readIdOrMetadaataId(metadataFallbackTarget)
          }
        ]);
      }
      if (options.verifyValueBefore && supportsValueBefore(mutation) && mutation.valueBefore !== void 0) {
        const actual = resolveObservableTarget(current, mutation, path);
        if (!isStructurallyEqual(actual, mutation.valueBefore)) {
          return reject([
            {
              code: "PRECONDITION_FAILED",
              message: `Mutation ${mutationIndex} valueBefore does not match its current target`,
              mutationIndex,
              path: mutations[mutationIndex]?.path ?? mutation.path,
              identity: mutation.targetUniqueName
            }
          ]);
        }
      }
      const destinationDiagnostic = validateStructuralDestination(
        current,
        mutation,
        path,
        mutationIndex,
        mutations[mutationIndex]?.path ?? mutation.path
      );
      if (destinationDiagnostic) {
        return reject([destinationDiagnostic]);
      }
      const skeletonBefore = isUpdateMutation(mutation) ? collectIdentitySkeleton(current) : void 0;
      current = applySingle(current, mutation, options);
      if (skeletonBefore) {
        const skeletonAfter = collectIdentitySkeleton(current);
        if (!identitySkeletonsEqual(skeletonBefore, skeletonAfter)) {
          return reject([
            {
              code: "IDENTITY_MUTATION_FORBIDDEN",
              message: "Strict update mutations must preserve the ordered full-tree identity skeleton",
              mutationIndex,
              path: mutations[mutationIndex]?.path ?? mutation.path,
              identity: mutation.targetUniqueName
            }
          ]);
        }
      }
    } catch (error2) {
      return reject([
        {
          code: "APPLY_FAILED",
          message: `Mutation ${mutationIndex} failed to apply: ${errorMessage(error2)}`,
          mutationIndex,
          path: mutations[mutationIndex]?.path ?? mutation.path,
          identity: mutation.targetUniqueName
        }
      ]);
    }
  }
  const resultStructureDiagnostics = validateExtendCoherence(current);
  if (resultStructureDiagnostics.length > 0) {
    return reject(resultStructureDiagnostics);
  }
  let resultIdentityDiagnostics;
  try {
    resultIdentityDiagnostics = validateIdentities(
      current,
      options.identityPolicy ?? "allow-missing"
    );
  } catch (error2) {
    return reject([
      {
        code: "RESULT_IDENTITY_INVALID",
        message: `Result identity validation failed: ${errorMessage(error2)}`
      }
    ]);
  }
  if (resultIdentityDiagnostics.length > 0) {
    return reject(
      resultIdentityDiagnostics.map((diagnostic) => ({
        code: "RESULT_IDENTITY_INVALID",
        message: `Result identity validation failed: ${diagnostic.message}`,
        identity: diagnostic.identity
      }))
    );
  }
  return {
    status: "applied",
    value: current,
    mutations,
    diagnostics: []
  };
};
function applyMutations(root, mutations, opts = {}) {
  let current = root;
  for (const mutation of mutations) {
    current = applySingle(current, mutation, opts);
  }
  return current;
}
function diffNodes(oldNode, newNode, basePath = [], opts = {}) {
  const pathItems = Array.isArray(basePath) ? basePath : parsePath(basePath);
  if (!sameKind(oldNode, newNode)) {
    throw new XnlPathError("Root kinds must match to diff");
  }
  if (isValueLiteral(oldNode) || isComment3(oldNode)) {
    return oldNode === newNode ? [] : [{ type: "OBJECT_UPDATE", path: pathToDsl(pathItems), valueAfter: newNode }];
  }
  if (Array.isArray(oldNode) && Array.isArray(newNode)) {
    return diffArray(oldNode, newNode, pathItems, void 0, void 0, opts);
  }
  if (isPlainObject4(oldNode) && isPlainObject4(newNode)) {
    return diffMap(oldNode, newNode, pathItems, void 0, void 0, opts);
  }
  if (isTextElement2(oldNode) && isTextElement2(newNode)) {
    return diffTextElement(oldNode, newNode, pathItems, opts);
  }
  if (isDataElement2(oldNode) && isDataElement2(newNode)) {
    const mutations = diffDataElement(oldNode, newNode, pathItems, opts);
    return reconcileMoves(mutations, opts);
  }
  return [];
}
function applySingle(root, mutation, opts) {
  const { type, path, valueAfter } = mutation;
  const pathItems = Array.isArray(path) ? path : parsePath(path);
  if (resolveMetaIdMode(opts) === "identity" && isMetadataIdPath(pathItems)) {
    return root;
  }
  if (type === "TREE_MOVE" || type === "TREE_MOVE_SAME_LEVEL" || type === "TREE_MOVE_CROSS_LEVEL") {
    if (!mutation.targetUniqueName && !mutation.pathBefore) {
      throw new XnlPathError("TREE_MOVE requires targetUniqueName or pathBefore");
    }
    const fromPath = mutation.pathBefore ? Array.isArray(mutation.pathBefore) ? mutation.pathBefore : parsePath(mutation.pathBefore) : [];
    let moved = mutation.targetUniqueName ? extractByUniqueId(root, mutation.targetUniqueName) : void 0;
    if (moved === void 0 && fromPath.length > 0) {
      try {
        const found = resolvePath(root, fromPath, { strict: false });
        if (moved === void 0) moved = found;
        deleteAtPath(root, fromPath, { strict: false });
      } catch {
      }
    }
    if (moved === void 0 && mutation.targetUniqueName) {
      throw new XnlPathError(`TREE_MOVE could not find node '${mutation.targetUniqueName}' to move`);
    }
    return applySingle(root, { ...mutation, type: "TREE_ADD", path, valueAfter: moved }, opts);
  }
  switch (type) {
    case "TREE_ADD":
      setPathValue(root, pathItems, valueAfter, {
        mode: "insert",
        destinationKey: mutation.destinationKey
      });
      return root;
    case "TREE_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    case "TREE_UPDATE":
      setPathValue(root, pathItems, valueAfter, {
        mode: "replace",
        destinationKey: mutation.destinationKey
      });
      return root;
    case "OBJECT_ADD":
    case "OBJECT_UPDATE":
      setPathValue(root, pathItems, valueAfter, {
        mode: "replace",
        destinationKey: mutation.destinationKey
      });
      return root;
    case "OBJECT_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    default:
      throw new XnlPathError(`Unknown mutation type ${type}`);
  }
}
function diffOptionalAttributes(oldAttributes, newAttributes, basePath, parentBefore, parentAfter, opts) {
  if (oldAttributes === void 0 && newAttributes !== void 0) {
    return [{
      type: "OBJECT_ADD",
      path: pathToDsl(basePath),
      valueAfter: newAttributes,
      parentUniqueNameAfter: readIdOrMetadaataId(parentAfter)
    }];
  }
  if (oldAttributes !== void 0 && newAttributes === void 0) {
    return [{
      type: "OBJECT_DELETE",
      path: pathToDsl(basePath),
      valueBefore: oldAttributes,
      parentUniqueNameBefore: readIdOrMetadaataId(parentBefore)
    }];
  }
  if (oldAttributes === void 0 || newAttributes === void 0) {
    return [];
  }
  return diffMap(oldAttributes, newAttributes, basePath, parentBefore, parentAfter, opts);
}
function diffTextElement(oldNode, newNode, basePath, opts) {
  const mutations = [];
  if (oldNode.tag !== newNode.tag) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("tag")]),
      valueBefore: oldNode.tag,
      valueAfter: newNode.tag
    });
  }
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, [...basePath, ip("metadata")], oldNode, newNode, opts));
  mutations.push(
    ...diffOptionalAttributes(
      oldNode.attributes,
      newNode.attributes,
      [...basePath, ip("attributes")],
      oldNode,
      newNode,
      opts
    )
  );
  if (oldNode.text !== newNode.text) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("text")]),
      valueAfter: newNode.text
    });
  }
  if (oldNode.textMarker !== newNode.textMarker) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("textMarker")]),
      valueAfter: newNode.textMarker
    });
  }
  return mutations;
}
function diffDataElement(oldNode, newNode, basePath, opts) {
  const mutations = [];
  if (oldNode.tag !== newNode.tag) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("tag")]),
      valueBefore: oldNode.tag,
      valueAfter: newNode.tag
    });
  }
  const metaPath = [...basePath, ip("metadata")];
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, metaPath, oldNode, newNode, opts));
  const attrPath = [...basePath, ip("attributes")];
  mutations.push(
    ...diffOptionalAttributes(
      oldNode.attributes,
      newNode.attributes,
      attrPath,
      oldNode,
      newNode,
      opts
    )
  );
  if (oldNode.body || newNode.body) {
    mutations.push(
      ...diffArray(oldNode.body ?? [], newNode.body ?? [], [...basePath, ip("body")], oldNode, newNode, opts)
    );
  }
  const parentId = resolveMetaIdMode(opts) === "identity" ? readIdOrMetadaataId(oldNode) ?? readIdOrMetadaataId(newNode) : void 0;
  const bodyPath = parentId ? [ms("id", parentId), ip("body")] : [...basePath, ip("body")];
  if (oldNode.body === void 0 && newNode.body?.length === 0) {
    mutations.push({
      type: "OBJECT_ADD",
      path: pathToDsl(bodyPath),
      valueAfter: []
    });
  } else if (oldNode.body !== void 0 && newNode.body === void 0) {
    mutations.push({
      type: "OBJECT_DELETE",
      path: pathToDsl(bodyPath)
    });
  }
  if (oldNode.extend || newNode.extend) {
    const extendMutations = diffExtend(
      oldNode.extend,
      newNode.extend,
      [...basePath, ip("extend")],
      oldNode,
      newNode,
      opts
    );
    mutations.push(...extendMutations);
    const extendPath = parentId ? [ms("id", parentId), ip("extend")] : [...basePath, ip("extend")];
    if (oldNode.extend === void 0 && newNode.extend !== void 0 && extendMutations.length === 0) {
      mutations.push({
        type: "OBJECT_ADD",
        path: pathToDsl(extendPath),
        valueAfter: newNode.extend
      });
    } else if (oldNode.extend !== void 0 && newNode.extend === void 0) {
      mutations.push({
        type: "OBJECT_DELETE",
        path: pathToDsl(extendPath)
      });
    }
  }
  return mutations;
}
function diffArray(oldArr, newArr, basePath, parentBefore, parentAfter, opts) {
  const mutations = [];
  const parentId = resolveMetaIdMode(opts) === "identity" ? readIdOrMetadaataId(parentBefore) ?? readIdOrMetadaataId(parentAfter) : void 0;
  const pathBase = parentId ? [ms("id", parentId), ip("body")] : basePath;
  const oldById = {};
  const newById = {};
  oldArr.forEach((item, idx) => {
    const id = readIdOrMetadaataId(item);
    if (id) oldById[id] = { index: idx, value: item };
  });
  newArr.forEach((item, idx) => {
    const id = readIdOrMetadaataId(item);
    if (id) newById[id] = { index: idx, value: item };
  });
  const max = Math.max(oldArr.length, newArr.length);
  for (let i = 0; i < max; i++) {
    const oldItem = oldArr[i];
    const newItem = newArr[i];
    const path = [...pathBase, li(i)];
    if (oldItem === void 0 && newItem !== void 0) {
      const id = readIdOrMetadaataId(newItem);
      mutations.push({
        type: "TREE_ADD",
        path: pathToDsl(path),
        valueAfter: newItem,
        targetUniqueName: id,
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter)
      });
      continue;
    }
    if (oldItem !== void 0 && newItem === void 0) {
      const id = readIdOrMetadaataId(oldItem);
      mutations.push({
        type: "TREE_DELETE",
        path: pathToDsl(path),
        valueBefore: oldItem,
        targetUniqueName: id,
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore)
      });
      continue;
    }
    if (oldItem !== void 0 && newItem !== void 0) {
      const useIdentity = resolveMetaIdMode(opts) === "identity";
      const oldId = readIdOrMetadaataId(oldItem);
      const newId = readIdOrMetadaataId(newItem);
      if (useIdentity && oldId && newId && oldId !== newId) {
        mutations.push({
          type: "TREE_DELETE",
          path: pathToDsl(path),
          valueBefore: oldItem,
          targetUniqueName: oldId,
          parentUniqueNameBefore: readIdOrMetadaataId(parentBefore)
        });
        mutations.push({
          type: "TREE_ADD",
          path: pathToDsl(path),
          valueAfter: newItem,
          targetUniqueName: newId,
          parentUniqueNameAfter: readIdOrMetadaataId(parentAfter)
        });
        continue;
      }
      if (isEqual(oldItem, newItem)) {
        continue;
      }
      const nested = diffNodes(oldItem, newItem, path, opts);
      if (nested.length === 0) {
        if (!useIdentity) {
          mutations.push({
            type: "TREE_UPDATE",
            path: pathToDsl(path),
            valueAfter: newItem,
            targetUniqueName: readIdOrMetadaataId(newItem)
          });
        }
      } else {
        mutations.push(...nested);
      }
    }
  }
  if (resolveMetaIdMode(opts) === "identity") {
    const oldIds = oldArr.map(readIdOrMetadaataId).filter(Boolean);
    const newIds = newArr.map(readIdOrMetadaataId).filter(Boolean);
    const identityOrderChanged = oldIds.length !== newIds.length || oldIds.some((id, index) => id !== newIds[index]);
    if (oldIds.length && newIds.length && identityOrderChanged) {
      for (const id of oldIds) {
        if (!(id in newById)) continue;
        const oldIdx = oldById[id]?.index ?? -1;
        const newIdx = newById[id]?.index ?? -1;
        if (oldIdx !== -1 && newIdx !== -1) {
          mutations.push({
            type: "TREE_MOVE_SAME_LEVEL",
            pathBefore: pathToDsl([...pathBase, li(oldIdx)]),
            path: pathToDsl([...pathBase, li(newIdx)]),
            targetUniqueName: id,
            parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
            parentUniqueNameAfter: readIdOrMetadaataId(parentAfter)
          });
        }
      }
    }
  }
  return mutations;
}
function diffMap(oldMap, newMap, basePath, parentBefore, parentAfter, opts) {
  const mutations = [];
  const keys = /* @__PURE__ */ new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]);
  for (const key of keys) {
    if (resolveMetaIdMode(opts) === "identity" && isMetadataMapPath(basePath) && key === "id") {
      continue;
    }
    const oldVal = (oldMap || {})[key];
    const newVal = (newMap || {})[key];
    const path = [...basePath, mk(key)];
    if (oldVal === void 0 && newVal !== void 0) {
      mutations.push({
        type: "OBJECT_ADD",
        path: pathToDsl(path),
        valueAfter: newVal,
        targetUniqueName: readIdOrMetadaataId(newVal),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter)
      });
      continue;
    }
    if (oldVal !== void 0 && newVal === void 0) {
      mutations.push({
        type: "OBJECT_DELETE",
        path: pathToDsl(path),
        valueBefore: oldVal,
        targetUniqueName: readIdOrMetadaataId(oldVal),
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore)
      });
      continue;
    }
    if (!isEqual(oldVal, newVal)) {
      const nested = diffNodes(oldVal, newVal, path, opts);
      if (nested.length === 0) {
        mutations.push({ type: "OBJECT_UPDATE", path: pathToDsl(path), valueAfter: newVal });
      } else {
        mutations.push(...nested);
      }
    }
  }
  return mutations;
}
function diffExtend(oldExtend, newExtend, basePath, parentBefore, parentAfter, opts) {
  const mutations = [];
  const parentId = resolveMetaIdMode(opts) === "identity" ? readIdOrMetadaataId(parentBefore) ?? readIdOrMetadaataId(parentAfter) : void 0;
  const pathBase = parentId ? [{ type: "UniqueName", value: parentId }, ip("extend")] : basePath;
  const oldChildren = oldExtend?.children ?? {};
  const newChildren = newExtend?.children ?? {};
  const oldOrder = oldExtend?.order ?? [];
  const newOrder = newExtend?.order ?? [];
  const oldByIdentity = /* @__PURE__ */ new Map();
  const usedOldTags = /* @__PURE__ */ new Set();
  const matchedByNewTag = /* @__PURE__ */ new Map();
  for (const tag of oldOrder) {
    const id = readIdOrMetadaataId(oldChildren[tag]);
    if (id && !oldByIdentity.has(id)) oldByIdentity.set(id, tag);
  }
  for (const tag of newOrder) {
    const newChild = newChildren[tag];
    const newId = readIdOrMetadaataId(newChild);
    const oldTagByIdentity = newId ? oldByIdentity.get(newId) : void 0;
    const oldTag = oldTagByIdentity && !usedOldTags.has(oldTagByIdentity) ? oldTagByIdentity : oldChildren[tag] !== void 0 && !usedOldTags.has(tag) ? tag : void 0;
    if (!oldTag) continue;
    usedOldTags.add(oldTag);
    matchedByNewTag.set(tag, { oldTag, oldChild: oldChildren[oldTag], newChild });
  }
  for (const tag of oldOrder) {
    const oldChild = oldChildren[tag];
    if (usedOldTags.has(tag)) continue;
    mutations.push({
      type: "TREE_DELETE",
      path: pathToDsl([...pathBase, mk(tag)]),
      valueBefore: oldChild,
      targetUniqueName: readIdOrMetadaataId(oldChild),
      parentUniqueNameBefore: readIdOrMetadaataId(parentBefore)
    });
  }
  const workingOrder = oldOrder.filter((tag) => usedOldTags.has(tag));
  const currentTagByOldTag = /* @__PURE__ */ new Map();
  for (const tag of oldOrder) {
    if (usedOldTags.has(tag)) currentTagByOldTag.set(tag, tag);
  }
  for (let newIndex = 0; newIndex < newOrder.length; newIndex++) {
    const newTag = newOrder[newIndex];
    const match = matchedByNewTag.get(newTag);
    if (!match) {
      const newChild = newChildren[newTag];
      mutations.push({
        type: "TREE_ADD",
        path: pathToDsl([...pathBase, li(newIndex)]),
        valueAfter: newChild,
        targetUniqueName: readIdOrMetadaataId(newChild),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter)
      });
      const insertAt = Math.max(0, Math.min(newIndex, workingOrder.length));
      workingOrder.splice(insertAt, 0, newTag);
      continue;
    }
    const currentTag = currentTagByOldTag.get(match.oldTag) ?? match.oldTag;
    const currentIndex = workingOrder.indexOf(currentTag);
    if (currentIndex === -1) continue;
    if (currentIndex !== newIndex || currentTag !== newTag) {
      const id2 = readIdOrMetadaataId(match.oldChild);
      mutations.push({
        type: "TREE_MOVE_SAME_LEVEL",
        pathBefore: pathToDsl([...pathBase, li(currentIndex)]),
        path: pathToDsl([...pathBase, li(newIndex)]),
        valueBefore: match.oldChild,
        valueAfter: match.newChild,
        destinationKey: currentTag === newTag ? void 0 : newTag,
        targetUniqueName: id2,
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter)
      });
      workingOrder.splice(currentIndex, 1);
      workingOrder.splice(newIndex, 0, newTag);
      currentTagByOldTag.set(match.oldTag, newTag);
    }
    const id = readIdOrMetadaataId(match.oldChild) ?? readIdOrMetadaataId(match.newChild);
    const childPath = id ? [{ type: "UniqueName", value: id }] : [...pathBase, mk(newTag)];
    const nested = diffNodes(match.oldChild, match.newChild, childPath, opts);
    if (nested.length === 0) {
      if (!isStructurallyEqual(match.oldChild, match.newChild)) {
        mutations.push({ type: "TREE_UPDATE", path: pathToDsl(childPath), valueAfter: match.newChild });
      }
    } else {
      mutations.push(...nested);
    }
  }
  return mutations;
}
function pathToDsl(path) {
  let out = "";
  for (const item of path) {
    if (item.type === "UniqueName") {
      out += `#${item.value}`;
      continue;
    }
    if (item.type === "MetadataSelector") {
      out += item.value;
      continue;
    }
    if (item.type === "InstanceProperty") {
      out += `:${item.value}`;
      continue;
    }
    if (item.type === "MapKey") {
      out += `::'${item.value}'`;
      continue;
    }
    out += `::${item.value}`;
  }
  return out;
}
function sameKind(a, b) {
  if (isDataElement2(a) && isDataElement2(b)) return true;
  if (isTextElement2(a) && isTextElement2(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return true;
  if (isPlainObject4(a) && isPlainObject4(b)) return true;
  if (isValueLiteral(a) && isValueLiteral(b)) return true;
  return typeof a === typeof b;
}
function isEqual(a, b) {
  if (isWord(a) && isWord(b)) {
    return wordToString(a) === wordToString(b);
  }
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => isEqual(item, b[idx]));
  }
  if (isPlainObject4(a) && isPlainObject4(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => isEqual(a[key], b[key]));
  }
  return false;
}
function isPlainObject4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isDataElement2(value) && !isTextElement2(value) && !isWord(value);
}
function isDataElement2(node) {
  return node && node.kind === "DataElement";
}
function isTextElement2(node) {
  return node && node.kind === "TextElement";
}
function isExtendBody2(node) {
  return node && typeof node === "object" && Array.isArray(node.order) && node.children;
}
function isValueLiteral(node) {
  return typeof node === "string" || typeof node === "number" || typeof node === "boolean" || node === null || isWord(node);
}
function isComment3(node) {
  return node && node.kind === "Comment";
}
var ip = (value) => ({ type: "InstanceProperty", value });
var mk = (value) => ({ type: "MapKey", value });
var li = (value) => ({ type: "ListIndex", value: String(value) });
function ms(key, value) {
  return { type: "MetadataSelector", value: `<${key}='${value}'>` };
}
function readIdOrMetadaataId(node) {
  if (isDataElement2(node) || isTextElement2(node)) {
    const nodeId = wordToString(node.id);
    if (nodeId) return nodeId;
    const metaId = node.metadata?.id;
    if (typeof metaId === "string") return metaId;
    if (isWord(metaId)) return wordToString(metaId);
  }
  return void 0;
}
function extractByUniqueId(root, id) {
  if (Array.isArray(root)) {
    const idx = root.findIndex((item) => readIdOrMetadaataId(item) === id);
    if (idx !== -1) {
      const [removed] = root.splice(idx, 1);
      return removed;
    }
    for (const item of root) {
      const found = extractByUniqueId(item, id);
      if (found !== void 0) return found;
    }
  } else if (isDataElement2(root)) {
    if (root.body) {
      const idx = root.body.findIndex((item) => readIdOrMetadaataId(item) === id);
      if (idx !== -1) {
        const [removed] = root.body.splice(idx, 1);
        return removed;
      }
      for (const child of root.body) {
        const found = extractByUniqueId(child, id);
        if (found !== void 0) return found;
      }
    }
    if (root.extend) {
      const tags = [...root.extend.order];
      for (const tag of tags) {
        const child = root.extend.children[tag];
        if (readIdOrMetadaataId(child) === id) {
          delete root.extend.children[tag];
          root.extend.order = root.extend.order.filter((t) => t !== tag);
          return child;
        }
        const found = extractByUniqueId(child, id);
        if (found !== void 0) return found;
      }
    }
  }
  return void 0;
}
function isExtendDestination(path) {
  const items = Array.isArray(path) ? path : parsePath(path);
  if (items.length < 2) return false;
  const parent = items[items.length - 2];
  const last = items[items.length - 1];
  return parent.type === "InstanceProperty" && parent.value === "extend" && (last.type === "ListIndex" || last.type === "MapKey");
}
function resolveMoveDestinationKey(add, del) {
  if (add.destinationKey !== void 0) return add.destinationKey;
  if (!isExtendDestination(add.path)) return void 0;
  const sourceTag = tagOf(del.valueBefore);
  const destinationTag = tagOf(add.valueAfter);
  return destinationTag !== void 0 && destinationTag !== sourceTag ? destinationTag : void 0;
}
function reconcileMoves(mutations, opts) {
  const addsById = {};
  const deletesById = {};
  for (const m of mutations) {
    if (m.type === "TREE_ADD" && m.targetUniqueName) {
      addsById[m.targetUniqueName] = addsById[m.targetUniqueName] ?? [];
      addsById[m.targetUniqueName].push(m);
    }
    if (m.type === "TREE_DELETE" && m.targetUniqueName) {
      deletesById[m.targetUniqueName] = deletesById[m.targetUniqueName] ?? [];
      deletesById[m.targetUniqueName].push(m);
    }
  }
  const result = [];
  const moveUpdates = [];
  const usedAdds = /* @__PURE__ */ new Set();
  const usedDeletes = /* @__PURE__ */ new Set();
  for (const [id, dels] of Object.entries(deletesById)) {
    const adds = addsById[id];
    if (!adds || adds.length === 0) continue;
    const del = dels[0];
    const add = adds[0];
    if (!isSameElementKind(del.valueBefore, add.valueAfter)) continue;
    usedAdds.add(add);
    usedDeletes.add(del);
    const sameParent = add.parentUniqueNameAfter !== void 0 && add.parentUniqueNameAfter === del.parentUniqueNameBefore;
    const type = sameParent ? "TREE_MOVE_SAME_LEVEL" : "TREE_MOVE_CROSS_LEVEL";
    const destinationKey = resolveMoveDestinationKey(add, del);
    const move = {
      type,
      path: add.path,
      pathBefore: del.path,
      valueBefore: del.valueBefore,
      valueAfter: add.valueAfter,
      ...destinationKey === void 0 ? {} : { destinationKey },
      targetUniqueName: id,
      parentUniqueNameBefore: del.parentUniqueNameBefore,
      parentUniqueNameAfter: add.parentUniqueNameAfter
    };
    result.push(move);
    moveUpdates.push(
      ...diffNodes(
        del.valueBefore,
        add.valueAfter,
        [{ type: "UniqueName", value: id }],
        opts
      )
    );
  }
  result.push(...moveUpdates);
  for (const m of mutations) {
    if (usedAdds.has(m) || usedDeletes.has(m)) continue;
    result.push(m);
  }
  const filtered = [];
  const seenMoveKeys = /* @__PURE__ */ new Set();
  for (const m of result) {
    if ((m.type === "TREE_MOVE_SAME_LEVEL" || m.type === "TREE_MOVE_CROSS_LEVEL") && m.targetUniqueName) {
      const key = `${m.type}:${m.targetUniqueName}:${JSON.stringify(m.path)}:${JSON.stringify(m.pathBefore)}`;
      if (seenMoveKeys.has(key)) continue;
      seenMoveKeys.add(key);
    }
    filtered.push(m);
  }
  return orderMutations(filtered);
}
function isSameElementKind(before, after) {
  return isDataElement2(before) && isDataElement2(after) || isTextElement2(before) && isTextElement2(after);
}
function listIndex(path) {
  if (path === void 0) return void 0;
  const items = Array.isArray(path) ? path : parsePath(path);
  const last = items[items.length - 1];
  return last?.type === "ListIndex" ? Number(last.value) : void 0;
}
function parentPath(path) {
  const items = Array.isArray(path) ? path : parsePath(path);
  return pathToDsl(items.slice(0, -1));
}
function orderMutations(mutations) {
  const indexed = mutations.map((mutation, order) => ({ mutation, order }));
  const deletes = indexed.filter(({ mutation }) => mutation.type === "TREE_DELETE").sort((left, right) => {
    const leftParent = parentPath(left.mutation.path);
    const rightParent = parentPath(right.mutation.path);
    if (leftParent !== rightParent) return left.order - right.order;
    return (listIndex(right.mutation.path) ?? Number.NEGATIVE_INFINITY) - (listIndex(left.mutation.path) ?? Number.NEGATIVE_INFINITY) || left.order - right.order;
  });
  const insertions = indexed.filter(
    ({ mutation }) => mutation.type === "TREE_ADD" || isMoveMutation(mutation)
  ).sort(
    (left, right) => (listIndex(left.mutation.path) ?? Number.POSITIVE_INFINITY) - (listIndex(right.mutation.path) ?? Number.POSITIVE_INFINITY) || left.order - right.order
  );
  const others = indexed.filter(
    ({ mutation }) => mutation.type !== "TREE_DELETE" && mutation.type !== "TREE_ADD" && !isMoveMutation(mutation)
  );
  return [...deletes, ...insertions, ...others].map(({ mutation }) => mutation);
}

// src/loader/index.ts
var SYSTEM_FIELDS = {
  proto: "proto",
  extendType: "extendType",
  exportFlag: "export",
  remove: "remove",
  name: "name",
  id: "id"
};
function loadFromString(input) {
  const parsed = parseXnl(input);
  const ctx = buildPrototypeContext(parsed.nodes);
  const resolvedNodes = parsed.nodes.map((n) => isDataElement3(n) ? resolveNode(ctx, n, []) : n);
  return { nodes: resolvedNodes, warnings: parsed.warnings };
}
function resolveNode(ctx, node, scope) {
  const protoName = readStringMeta(node.metadata, SYSTEM_FIELDS.proto);
  const extendType = readStringMeta(node.metadata, SYSTEM_FIELDS.extendType) ?? "Override";
  const localPrefabs = collectTypedPrefabs(node);
  const nextScope = [localPrefabs, ...scope];
  let resolved = cloneDataElement(node);
  if (protoName) {
    const proto = lookupPrototype(ctx, node.tag, protoName, nextScope);
    const merged = mergeNodes(ctx, proto, resolved, extendType, nextScope);
    resolved = merged;
  } else {
    resolved = resolveChildren(ctx, resolved, nextScope);
  }
  resolved.metadata = mergeMaps(ctx, {}, resolved.metadata, nextScope);
  resolved.attributes = mergeMaps(ctx, {}, resolved.attributes ?? {}, nextScope);
  stripControlMetadata(resolved.metadata);
  if (resolved.attributes) stripControlMetadata(resolved.attributes);
  return resolved;
}
function batchLoad(batches) {
  const allNodes = batches.flat();
  const ctx = buildPrototypeContext(allNodes);
  const exportsMap = {};
  const resolved = batches.map(
    (batch) => batch.map((node) => {
      if (!isDataElement3(node)) return node;
      const rawExportName = readExportName(node);
      let resolvedNode = resolveNode(ctx, node, []);
      resolvedNode = resolvePending(resolvedNode, ctx, []);
      const exportName = rawExportName ?? readExportName(resolvedNode);
      if (exportName) {
        exportsMap[resolvedNode.tag] = exportsMap[resolvedNode.tag] ?? {};
        exportsMap[resolvedNode.tag][exportName] = resolvedNode;
      }
      collectExportsFromPrefabs(resolvedNode, exportsMap);
      return resolvedNode;
    })
  );
  return { resolved, exports: exportsMap };
}
function buildPrototypeContext(nodes) {
  const prototypes = {};
  for (const node of nodes) {
    if (!isDataElement3(node)) continue;
    collectPrefabs(node, prototypes);
  }
  return { prototypes };
}
function collectPrefabs(node, store) {
  const typed = collectTypedPrefabs(node);
  for (const [type, prefabs] of Object.entries(typed)) {
    store[type] = store[type] ?? {};
    for (const [name, prefab] of Object.entries(prefabs)) {
      if (!store[type][name]) {
        store[type][name] = cloneDataElement(prefab);
      }
    }
  }
  if (node.body) {
    for (const child of node.body) {
      if (isDataElement3(child)) collectPrefabs(child, store);
    }
  }
  if (node.extend) {
    for (const tag of node.extend.order) {
      const child = node.extend.children[tag];
      if (isDataElement3(child)) collectPrefabs(child, store);
    }
  }
}
function collectExportsFromPrefabs(node, exportsMap) {
  if (!node.extend) return;
  const typed = collectTypedPrefabs(node);
  for (const [type, prefabs] of Object.entries(typed)) {
    for (const [name, prefab] of Object.entries(prefabs)) {
      exportsMap[type] = exportsMap[type] ?? {};
      exportsMap[type][name] = prefab;
    }
  }
}
function lookupPrototype(ctx, type, name, scope) {
  for (const prefabs of scope) {
    const foundScoped = prefabs[type]?.[name];
    if (foundScoped) return foundScoped;
  }
  const found = ctx.prototypes[type]?.[name];
  if (!found) {
    throw new Error(`Prototype not found for type '${type}' name '${name}'`);
  }
  return found;
}
function mergeNodes(ctx, base, override, extendType, scope) {
  if (extendType !== "Override") {
    throw new Error(`Unsupported extendType '${extendType}'`);
  }
  const merged = cloneDataElement(base);
  merged.id = override.id ?? base.id;
  merged.metadata = mergeMaps(ctx, base.metadata, override.metadata, scope);
  merged.attributes = mergeMaps(ctx, base.attributes ?? {}, override.attributes ?? {}, scope);
  merged.body = mergeBody(ctx, base.body ?? [], override.body ?? [], scope);
  merged.extend = mergeExtend(ctx, base.extend, override.extend, scope);
  stripControlMetadata(merged.metadata);
  if (merged.attributes) stripControlMetadata(merged.attributes);
  return merged;
}
function resolveChildren(ctx, node, scope) {
  const copy = cloneDataElement(node);
  if (copy.body) {
    copy.body = copy.body.map((item) => resolveValue(ctx, item, scope));
  }
  if (copy.extend) {
    const nextChildren = {};
    for (const tag of copy.extend.order) {
      const child = copy.extend.children[tag];
      nextChildren[tag] = resolveValue(ctx, child, scope);
    }
    copy.extend = { order: [...copy.extend.order], children: nextChildren };
  }
  return copy;
}
function mergeBody(ctx, baseBody, overrideBody, scope) {
  const result = [];
  const baseById = {};
  for (const item of baseBody) {
    const id = readElementId(item);
    if (id) baseById[id] = item;
    result.push(resolveValue(ctx, item, scope));
  }
  for (const item of overrideBody) {
    if (isRemoveFlag(item) || isRemoveMarker(item)) {
      const id2 = readElementId(item);
      if (id2 && baseById[id2]) {
        const index = result.findIndex((n) => readElementId(n) === id2);
        if (index >= 0) {
          result.splice(index, 1);
        }
      }
      continue;
    }
    const id = readElementId(item);
    if (id && baseById[id] && isDataElement3(baseById[id]) && isDataElement3(item)) {
      const merged = mergeNodes(ctx, baseById[id], item, "Override", scope);
      const idx = result.findIndex((n) => readElementId(n) === id);
      if (idx >= 0) {
        result[idx] = merged;
        continue;
      }
    }
    result.push(resolveValue(ctx, item, scope));
  }
  return result;
}
function mergeExtend(ctx, baseExtend, overrideExtend, scope) {
  if (!baseExtend && !overrideExtend) return void 0;
  if (!baseExtend) return resolveExtend(ctx, overrideExtend, scope);
  if (!overrideExtend) return resolveExtend(ctx, baseExtend, scope);
  const order = [...baseExtend.order];
  const children = { ...baseExtend.children };
  for (const tag of overrideExtend.order) {
    const child = overrideExtend.children[tag];
    const existing = children[tag];
    if (isDataElement3(child) && (isRemoveFlag(child) || isRemoveMarker(child))) {
      delete children[tag];
      const idx = order.indexOf(tag);
      if (idx >= 0) order.splice(idx, 1);
      continue;
    }
    if (existing && isDataElement3(existing) && isDataElement3(child)) {
      children[tag] = mergeNodes(ctx, existing, child, "Override", scope);
    } else {
      children[tag] = resolveValue(ctx, child, scope);
    }
    if (!order.includes(tag)) order.push(tag);
  }
  return { order, children };
}
function resolveExtend(ctx, extend, scope) {
  if (!extend) return void 0;
  const children = {};
  for (const tag of extend.order) {
    const child = extend.children[tag];
    children[tag] = resolveValue(ctx, child, scope);
  }
  return { order: [...extend.order], children };
}
function cloneDataElement(node) {
  return {
    kind: "DataElement",
    tag: node.tag,
    id: node.id ? cloneWord(node.id) : void 0,
    metadata: cloneMap(node.metadata),
    attributes: node.attributes ? cloneMap(node.attributes) : void 0,
    body: node.body ? node.body.map((n) => cloneNode(n)) : void 0,
    extend: node.extend ? cloneExtend(node.extend) : void 0
  };
}
function cloneExtend(extend) {
  const children = {};
  for (const tag of extend.order) {
    children[tag] = cloneNode(extend.children[tag]);
  }
  return { order: [...extend.order], children };
}
function cloneNode(node) {
  if (Array.isArray(node)) {
    return node.map((n) => cloneNode(n));
  }
  if (isWord(node)) {
    return cloneWord(node);
  }
  if (isPlainObject5(node)) {
    const out = {};
    for (const key of Object.keys(node)) {
      out[key] = cloneNode(node[key]);
    }
    return out;
  }
  if (isDataElement3(node)) return cloneDataElement(node);
  return node;
}
function cloneMap(map) {
  const out = {};
  for (const key of Object.keys(map || {})) {
    out[key] = cloneNode(map[key]);
  }
  return out;
}
function mergeMaps(ctx, base, override, scope) {
  const result = cloneMap(base || {});
  for (const key of Object.keys(override || {})) {
    const value = override[key];
    if (isRemoveMarker(value)) {
      delete result[key];
      continue;
    }
    const resolvedValue = resolveValue(ctx, value, scope);
    if (isPlainObject5(resolvedValue) && isPlainObject5(result[key])) {
      result[key] = mergeMaps(ctx, result[key], resolvedValue, scope);
    } else if (Array.isArray(resolvedValue) && Array.isArray(result[key])) {
      result[key] = mergeArray(ctx, result[key], resolvedValue, scope);
    } else {
      result[key] = resolvedValue;
    }
  }
  return result;
}
function mergeArray(ctx, baseArr, overrideArr, scope) {
  const result = baseArr.map((v) => resolveValue(ctx, v, scope));
  for (let i = 0; i < overrideArr.length; i++) {
    const value = overrideArr[i];
    if (isRemoveMarker(value)) {
      if (i < result.length) result.splice(i, 1);
      continue;
    }
    const resolved = resolveValue(ctx, value, scope);
    if (i < result.length) {
      const baseVal = result[i];
      if (isPlainObject5(baseVal) && isPlainObject5(resolved)) {
        result[i] = mergeMaps(ctx, baseVal, resolved, scope);
      } else if (Array.isArray(baseVal) && Array.isArray(resolved)) {
        result[i] = mergeArray(ctx, baseVal, resolved, scope);
      } else {
        result[i] = resolved;
      }
    } else {
      result.push(resolved);
    }
  }
  return result;
}
function stripControlMetadata(meta) {
  delete meta[SYSTEM_FIELDS.proto];
  delete meta[SYSTEM_FIELDS.extendType];
  delete meta[SYSTEM_FIELDS.exportFlag];
  delete meta[SYSTEM_FIELDS.remove];
}
function readExportName(node) {
  const exported = node.metadata?.[SYSTEM_FIELDS.exportFlag];
  if (exported !== true && exported !== "true") return void 0;
  const id = wordToString(node.id);
  if (id) return id;
  const nameVal = node.metadata?.[SYSTEM_FIELDS.name];
  const name = asString(nameVal);
  return name;
}
function readElementId(node) {
  if (isDataElement3(node) || isTextElement3(node)) {
    const idVal = node.id;
    const id = wordToString(idVal);
    if (id) return id;
    const metaId = node.metadata?.[SYSTEM_FIELDS.id];
    const metaIdStr = asString(metaId);
    if (metaIdStr) return metaIdStr;
  }
  return void 0;
}
function readStringMeta(meta, key) {
  const val = meta?.[key];
  return asString(val);
}
function isRemoveFlag(node) {
  return !!(node && (node.metadata?.[SYSTEM_FIELDS.remove] === true || node.metadata?.[SYSTEM_FIELDS.remove] === "true"));
}
function isRemoveMarker(node) {
  return isDataElement3(node) && node.tag === "delta" && isRemoveFlag(node);
}
function isDataElement3(node) {
  return node && node.kind === "DataElement";
}
function isTextElement3(node) {
  return node && node.kind === "TextElement";
}
function isPlainObject5(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isDataElement3(value) && !isWord(value);
}
function resolveValue(ctx, value, scope) {
  if (isDataElement3(value)) {
    const proto = readStringMeta(value.metadata, SYSTEM_FIELDS.proto);
    if (proto) {
      return resolveNode(ctx, value, scope);
    }
    const resolved = resolveChildren(ctx, value, scope);
    resolved.attributes = mergeMaps(ctx, {}, resolved.attributes ?? {}, scope);
    resolved.metadata = mergeMaps(ctx, {}, resolved.metadata ?? {}, scope);
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(ctx, v, scope));
  }
  if (isPlainObject5(value)) {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = resolveValue(ctx, value[key], scope);
    }
    return out;
  }
  return cloneNode(value);
}
function collectTypedPrefabs(node) {
  const result = {};
  if (!node.extend) return result;
  const suffix = "Prefabs";
  for (const tag of node.extend.order) {
    const child = node.extend.children[tag];
    if (!isDataElement3(child) || !child.body) continue;
    if (tag === "Prefabs") {
      for (const prefab of child.body) {
        if (!isDataElement3(prefab)) continue;
        const name = readExportName(prefab) ?? readElementId(prefab);
        if (!name) continue;
        const type = prefab.tag;
        result[type] = result[type] ?? {};
        result[type][name] = cloneDataElement(prefab);
      }
      continue;
    }
    if (tag.endsWith(suffix)) {
      const type = tag.slice(0, tag.length - suffix.length);
      for (const prefab of child.body) {
        if (!isDataElement3(prefab)) continue;
        const name = readExportName(prefab) ?? readElementId(prefab);
        if (!name) continue;
        result[type] = result[type] ?? {};
        result[type][name] = cloneDataElement(prefab);
      }
    }
  }
  return result;
}
function resolvePending(node, ctx, scope) {
  const resolved = resolveNode(ctx, node, scope);
  return resolved;
}
function cloneWord(word) {
  return { kind: "Word", namespace: [...word.namespace ?? []], name: word.name };
}
function asString(value) {
  if (isWord(value)) return wordToString(value) ?? void 0;
  if (typeof value === "string") return value;
  return void 0;
}

// src/import/index.ts
var XnlImportError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "XnlImportError";
    this.code = code;
  }
};
var VFS_PREFIX = "vfs://";
function isDataElement4(node) {
  return Boolean(node && typeof node === "object" && node.kind === "DataElement");
}
function readStringMeta2(meta, key) {
  const v = meta?.[key];
  if (typeof v === "string") return v;
  if (isWord(v)) return wordToString(v) ?? void 0;
  return void 0;
}
function joinAndNormalize(...parts) {
  const segs = [];
  for (const part of parts) {
    for (const s of part.split("/")) {
      if (s === "" || s === ".") continue;
      if (s === "..") {
        if (segs.length) segs.pop();
        continue;
      }
      segs.push(s);
    }
  }
  return "/" + segs.join("/");
}
function resolveVfsSrc(src, opts) {
  if (!src.startsWith(VFS_PREFIX)) {
    throw new XnlImportError("INVALID_IMPORT", `Import src must be a vfs:// path: ${src}`);
  }
  const rest = src.slice(VFS_PREFIX.length);
  if (rest === "@" || rest.startsWith("@/")) {
    return joinAndNormalize(opts.workspaceRoot, rest.startsWith("@/") ? rest.slice(2) : "");
  }
  if (rest.startsWith("./") || rest.startsWith("../") || rest === "..") {
    return joinAndNormalize(opts.baseDir, rest);
  }
  return joinAndNormalize(opts.workspaceRoot, rest);
}
function collectExports(content) {
  const doc = parseXnl(content);
  const batch = doc.nodes.filter(isDataElement4);
  const { exports } = batchLoad([batch]);
  return exports;
}
function loadImportTarget(target, resolver) {
  if (resolver.isDir(target)) {
    const entries = (resolver.readDir(target) ?? []).filter((e) => e.endsWith(".xnl")).sort();
    const out = [];
    for (const entry of entries) {
      const p = joinAndNormalize(target, entry);
      const content2 = resolver.readFile(p);
      if (content2 == null) continue;
      out.push({ srcPath: p, exports: collectExports(content2) });
    }
    return out;
  }
  const content = resolver.readFile(target);
  if (content == null) {
    throw new XnlImportError("IMPORT_NOT_FOUND", `Import source not found: ${target}`);
  }
  return [{ srcPath: target, exports: collectExports(content) }];
}
function mergeIntoSymbols(symbols, provenance, alias, source) {
  const ns = symbols[alias] = symbols[alias] ?? {};
  for (const tag of Object.keys(source.exports)) {
    for (const name of Object.keys(source.exports[tag])) {
      const provKey = `${alias}|${name}`;
      const prevSrc = provenance[provKey];
      if (prevSrc !== void 0 && prevSrc !== source.srcPath) {
        throw new XnlImportError(
          "DUPLICATE_IMPORT",
          `Duplicate import symbol '${alias}:${name}' from '${prevSrc}' and '${source.srcPath}'`
        );
      }
      provenance[provKey] = source.srcPath;
      ns[name] = source.exports[tag][name];
    }
  }
}
function collectImportDirectives(importsNode) {
  const out = [];
  for (const child of importsNode.body ?? []) {
    if (isDataElement4(child) && child.tag === "Import") out.push(child);
  }
  if (importsNode.extend) {
    for (const tag of importsNode.extend.order) {
      const child = importsNode.extend.children[tag];
      if (isDataElement4(child) && child.tag === "Import") out.push(child);
    }
  }
  return out;
}
var REF_RE = /^([A-Za-z_][\w-]*):([A-Za-z_][\w.\-]*)$/;
function validateReferences(rootDoc, symbols) {
  const check = (value) => {
    if (typeof value !== "string") return;
    const m = REF_RE.exec(value);
    if (!m) return;
    const [, alias, name] = m;
    if (symbols[alias] !== void 0 && symbols[alias][name] === void 0) {
      throw new XnlImportError("UNRESOLVED_IMPORT", `Unresolved import reference '${value}'`);
    }
  };
  const walk = (node) => {
    if (isDataElement4(node)) {
      for (const v of Object.values(node.metadata ?? {})) check(v);
      for (const v of Object.values(node.attributes ?? {})) check(v);
      for (const child of node.body ?? []) walk(child);
      if (node.extend) {
        for (const tag of node.extend.order) walk(node.extend.children[tag]);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
    }
  };
  for (const node of rootDoc.nodes) walk(node);
}
function resolveImports(rootDoc, resolver, opts) {
  const importsNode = rootDoc.nodes.find(
    (n) => isDataElement4(n) && n.tag === "Imports"
  );
  if (!importsNode) {
    return { resolved: rootDoc, symbols: {}, warnings: [] };
  }
  const symbols = {};
  const provenance = {};
  const warnings = [];
  for (const directive of collectImportDirectives(importsNode)) {
    const alias = readStringMeta2(directive.metadata, "as");
    const src = readStringMeta2(directive.metadata, "src");
    if (!alias || !src) {
      throw new XnlImportError("INVALID_IMPORT", "<Import> requires both 'as' and 'src'");
    }
    const target = resolveVfsSrc(src, opts);
    for (const source of loadImportTarget(target, resolver)) {
      mergeIntoSymbols(symbols, provenance, alias, source);
    }
  }
  validateReferences(rootDoc, symbols);
  return { resolved: rootDoc, symbols, warnings };
}

// src/NodeHelper.ts
function GetWordFullName(word) {
  const parts = [...word.namespace ?? [], word.name].filter((part) => part.length > 0);
  return parts.join(".");
}
function MakeWord(wordStr, namespace = []) {
  return {
    kind: "Word",
    namespace,
    name: wordStr
  };
}

// src/index.ts
var XNL = {
  parseMany: parseXnl,
  parseSingle: parseXnlSingleNode,
  parseUnique: parseUniqueChildren,
  stringify,
  stringifyLineBlock: stringify2,
  path: {
    parse: parsePath,
    resolve: resolvePath,
    set: setPathValue,
    delete: deleteAtPath
  },
  mutation: {
    apply: applyMutations,
    diff: diffNodes,
    dryRun: dryRunMutations,
    preview: dryRunMutations
  },
  loader: {
    loadFromString,
    loadNode: resolveNode,
    batchLoad
  },
  import: {
    resolve: resolveImports,
    resolveVfsSrc
  }
};

exports.GetWordFullName = GetWordFullName;
exports.MakeWord = MakeWord;
exports.XNL = XNL;
exports.XnlImportError = XnlImportError;
exports.XnlParseError = XnlParseError;
exports.XnlPathError = XnlPathError;
exports.applyMutations = applyMutations;
exports.batchLoad = batchLoad;
exports.deleteAtPath = deleteAtPath;
exports.diffNodes = diffNodes;
exports.dryRunMutations = dryRunMutations;
exports.isWord = isWord;
exports.loadFromString = loadFromString;
exports.loadNode = resolveNode;
exports.parsePath = parsePath;
exports.parseUniqueChildren = parseUniqueChildren;
exports.parseXnl = parseXnl;
exports.parseXnlSingleNode = parseXnlSingleNode;
exports.resolveImports = resolveImports;
exports.resolvePath = resolvePath;
exports.resolveVfsSrc = resolveVfsSrc;
exports.setPathValue = setPathValue;
exports.stringifyLineBlock = stringify2;
exports.wordToString = wordToString;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map