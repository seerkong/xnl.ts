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
function parseXnl(input) {
  const warnings = [];
  const nodes = parseNodesFromString(input, warnings);
  return { nodes, warnings };
}
function parseXnlSingleNode(input) {
  const warnings = [];
  const state = { input, pos: 0, length: input.length, warnings };
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
function parseNodesFromString(input, warnings) {
  const state = { input, pos: 0, length: input.length, warnings };
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
  const tag = readIdentifier(state, "Expected node name");
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
    const content = stripComments(dedentContent(state.input.slice(start, idx), closingIndent));
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
  if (!isIdentifierStart(peek(state))) return void 0;
  return readIdentifier(state, "Expected marker");
}
function readKey(state, message) {
  const ch = peek(state);
  if (ch === '"' || ch === "'") {
    return parseStringLiteral(state);
  }
  return readIdentifier(state, message);
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
    const pad = state.pretty ? state.indent.repeat(state.depth) : "";
    return `${pad}<!-- ${node.value} -->`;
  }
  if (isElement(node)) {
    const pad = state.pretty ? state.indent.repeat(state.depth) : "";
    if (node.kind === "TextElement") {
      const metaStr2 = serializeInlineAttributes(node.metadata, state);
      const attrStr = node.attributes ? ` ${serializeAttributeBlock(node.attributes, state)}` : "";
      const idPart2 = node.id ? ` #${formatWord(node.id)}` : "";
      const marker = node.textMarker ?? "";
      return `${pad}<${node.tag}${idPart2}${metaStr2}${attrStr} ?${marker}>${node.text ?? ""}</?${marker}>`;
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
  const pad = state.indent.repeat(nextDepth);
  const lines = Object.entries(attrs).map(
    ([k, v]) => `${pad}${serializeKey(k)} = ${serializeValueNode(v, { ...state, depth: nextDepth })}`
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
  const pad = state.indent.repeat(nextDepth);
  const lines = items.map((item) => `${pad}${serializeValueNode(item, { ...state, depth: nextDepth })}`);
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
  const pad = state.indent.repeat(nextDepth);
  const childStrings = extend.order.map((name) => `${pad}${serializeNode(extend.children[name], { ...state, depth: nextDepth })}`);
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
  const pad = state.indent.repeat(nextDepth);
  const lines = Object.entries(obj).map(
    ([k, v]) => `${pad}${serializeKey(k)} = ${serializeValueNode(v, { ...state, depth: nextDepth })}`
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
  const pad = state.indent.repeat(nextDepth);
  const lines = arr.map((v) => `${pad}${serializeValueNode(v, { ...state, depth: nextDepth })}`);
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
    if (c === "{") {
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
  const { strict = true } = options;
  const parsed = Array.isArray(path) ? path : parsePath(path);
  let current = target;
  for (const item of parsed) {
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
      const found = findByMetadataSelector(target, item.value);
      if (!found) {
        if (strict) throw new XnlPathError(`MetadataSelector '${item.value}' not found`);
        return void 0;
      }
      current = found;
      continue;
    }
    if (item.type === "InstanceProperty") {
      if (current && isDataElement(current)) {
        current = current[item.value];
      } else if (current && isTextElement(current)) {
        current = current[item.value];
      } else if (isPlainObject2(current) || isDocument2(current)) {
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
      if (!isPlainObject2(current)) {
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
        if (mode === "insert") {
          parent.order.splice(idx, 0, value.tag ?? String(idx));
          parent.children[value.tag ?? String(idx)] = value;
        } else {
          const tag = parent.order[idx];
          if (tag === void 0 && strict) {
            throw new XnlPathError(`Extend index ${idx} out of bounds`);
          }
          const useTag = value?.tag ?? tag;
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
      if (isPlainObject2(parent) || isDataElement(parent) || isTextElement(parent) || isDocument2(parent)) {
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
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  let current = target;
  for (const item of parentPath) {
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
      const found = findByMetadataSelector(target, item.value);
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
      } else if (isPlainObject2(current) || isDocument2(current)) {
        if (current[item.value] === void 0 && createMissing && isPlainObject2(current)) {
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
    if (c === ":" || c === "#" || c === "." || c === "{") break;
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
  const roots = isDocument2(target) ? target.nodes : [target];
  for (const root of roots) {
    const found = findInNode(root, id);
    if (found) return found;
  }
  return void 0;
}
function findByMetadataSelector(target, selector) {
  const parsed = parseMetadataSelectorValue(selector);
  const roots = isDocument2(target) ? target.nodes : [target];
  for (const root of roots) {
    const found = findInNodeByMeta(root, parsed.key, parsed.value);
    if (found) return found;
  }
  return void 0;
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
  } else if (isPlainObject2(node)) {
    for (const k of Object.keys(node)) {
      const found = findInNodeByMeta(node[k], key, value);
      if (found) return found;
    }
  }
  return void 0;
}
function parseMetadataSelectorValue(selector) {
  const m = selector.match(/^\{([A-Za-z_][A-Za-z0-9_-]*)=("([^"]*)"|'([^']*)')\}$/);
  if (!m) throw new XnlPathError("Invalid metadata selector");
  const key = m[1];
  const value = m[3] ?? m[4] ?? "";
  return { key, value };
}
function parseMetadataSelector(input, start) {
  if (input[start] !== "{") throw new XnlPathError("Metadata selector must start with '{'");
  const end = input.indexOf("}", start);
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
  } else if (isPlainObject2(node)) {
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
function isDocument2(value) {
  return value && typeof value === "object" && Array.isArray(value.nodes);
}
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isElementNode(value) && !isExtendBody(value) && !isWord(value);
}
function ensureMap(value, strict) {
  if (!isPlainObject2(value)) {
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
function applyMutations(root, mutations) {
  let current = root;
  for (const mutation of mutations) {
    current = applySingle(current, mutation);
  }
  return current;
}
function diffNodes(oldNode, newNode, basePath = []) {
  const pathItems = Array.isArray(basePath) ? basePath : parsePath(basePath);
  if (!sameKind(oldNode, newNode)) {
    throw new XnlPathError("Root kinds must match to diff");
  }
  if (isValueLiteral(oldNode) || isComment2(oldNode)) {
    return oldNode === newNode ? [] : [{ type: "OBJECT_UPDATE", path: pathItems, valueAfter: newNode }];
  }
  if (Array.isArray(oldNode) && Array.isArray(newNode)) {
    return diffArray(oldNode, newNode, pathItems);
  }
  if (isPlainObject3(oldNode) && isPlainObject3(newNode)) {
    return diffMap(oldNode, newNode, pathItems);
  }
  if (isTextElement2(oldNode) && isTextElement2(newNode)) {
    return diffTextElement(oldNode, newNode, pathItems);
  }
  if (isDataElement2(oldNode) && isDataElement2(newNode)) {
    const mutations = diffDataElement(oldNode, newNode, pathItems);
    return reconcileMoves(mutations);
  }
  return [];
}
function applySingle(root, mutation) {
  const { type, path, valueAfter } = mutation;
  const pathItems = Array.isArray(path) ? path : parsePath(path);
  if (type === "TREE_MOVE" || type === "TREE_MOVE_SAME_LEVEL" || type === "TREE_MOVE_CROSS_LEVEL") {
    if (!mutation.targetUniqueName && !mutation.pathBefore) {
      throw new XnlPathError("TREE_MOVE requires targetUniqueName or pathBefore");
    }
    const fromPath = mutation.pathBefore ? Array.isArray(mutation.pathBefore) ? mutation.pathBefore : parsePath(mutation.pathBefore) : [];
    let moved = mutation.targetUniqueName ? extractByMetaId(root, mutation.targetUniqueName) : void 0;
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
    return applySingle(root, { ...mutation, type: "TREE_ADD", path, valueAfter: moved });
  }
  switch (type) {
    case "TREE_ADD":
      setPathValue(root, pathItems, valueAfter, { mode: "insert" });
      return root;
    case "TREE_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    case "TREE_UPDATE":
      setPathValue(root, pathItems, valueAfter, { mode: "replace" });
      return root;
    case "OBJECT_ADD":
    case "OBJECT_UPDATE":
      setPathValue(root, pathItems, valueAfter, { mode: "replace" });
      return root;
    case "OBJECT_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    default:
      throw new XnlPathError(`Unknown mutation type ${type}`);
  }
}
function diffTextElement(oldNode, newNode, basePath) {
  const mutations = [];
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, [...basePath, ip("metadata")]));
  if (oldNode.attributes || newNode.attributes) {
    mutations.push(...diffMap(oldNode.attributes ?? {}, newNode.attributes ?? {}, [...basePath, ip("attributes")]));
  }
  if (oldNode.text !== newNode.text) {
    mutations.push({
      type: "TREE_UPDATE",
      path: [...basePath, ip("text")],
      valueAfter: newNode.text
    });
  }
  if (oldNode.textMarker !== newNode.textMarker) {
    mutations.push({
      type: "TREE_UPDATE",
      path: [...basePath, ip("textMarker")],
      valueAfter: newNode.textMarker
    });
  }
  return mutations;
}
function diffDataElement(oldNode, newNode, basePath) {
  const mutations = [];
  const metaPath = [...basePath, ip("metadata")];
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, metaPath, oldNode, newNode));
  const attrPath = [...basePath, ip("attributes")];
  mutations.push(...diffMap(oldNode.attributes ?? {}, newNode.attributes ?? {}, attrPath, oldNode, newNode));
  if (oldNode.body || newNode.body) {
    mutations.push(
      ...diffArray(oldNode.body ?? [], newNode.body ?? [], [...basePath, ip("body")], oldNode, newNode)
    );
  }
  if (oldNode.extend || newNode.extend) {
    mutations.push(...diffExtend(oldNode.extend, newNode.extend, [...basePath, ip("extend")], oldNode, newNode));
  }
  return mutations;
}
function diffArray(oldArr, newArr, basePath, parentBefore, parentAfter) {
  const mutations = [];
  const parentId = readMetaId(parentAfter) ?? readMetaId(parentBefore);
  const pathBase = parentId ? [ms("id", parentId), ip("body")] : basePath;
  const oldById = {};
  const newById = {};
  oldArr.forEach((item, idx) => {
    const id = readMetaId(item);
    if (id) oldById[id] = { index: idx, value: item };
  });
  newArr.forEach((item, idx) => {
    const id = readMetaId(item);
    if (id) newById[id] = { index: idx, value: item };
  });
  const max = Math.max(oldArr.length, newArr.length);
  for (let i = 0; i < max; i++) {
    const oldItem = oldArr[i];
    const newItem = newArr[i];
    const path = [...pathBase, li(i)];
    if (oldItem === void 0 && newItem !== void 0) {
      const id = readMetaId(newItem);
      mutations.push({
        type: "TREE_ADD",
        path,
        valueAfter: newItem,
        targetUniqueName: id,
        parentUniqueNameAfter: readMetaId(parentAfter)
      });
      continue;
    }
    if (oldItem !== void 0 && newItem === void 0) {
      const id = readMetaId(oldItem);
      mutations.push({
        type: "TREE_DELETE",
        path,
        valueBefore: oldItem,
        targetUniqueName: id,
        parentUniqueNameBefore: readMetaId(parentBefore)
      });
      continue;
    }
    if (oldItem !== void 0 && newItem !== void 0) {
      const oldId = readMetaId(oldItem);
      const newId = readMetaId(newItem);
      if (oldId && newId && oldId !== newId) {
        mutations.push({
          type: "TREE_DELETE",
          path,
          valueBefore: oldItem,
          targetUniqueName: oldId,
          parentUniqueNameBefore: readMetaId(parentBefore)
        });
        mutations.push({
          type: "TREE_ADD",
          path,
          valueAfter: newItem,
          targetUniqueName: newId,
          parentUniqueNameAfter: readMetaId(parentAfter)
        });
        continue;
      }
      if (isEqual(oldItem, newItem)) {
        continue;
      }
      const nested = diffNodes(oldItem, newItem, path);
      if (nested.length === 0) {
        mutations.push({ type: "TREE_UPDATE", path, valueAfter: newItem, targetUniqueName: readMetaId(newItem) });
      } else {
        mutations.push(...nested);
      }
    }
  }
  const oldIds = oldArr.map(readMetaId).filter(Boolean);
  const newIds = newArr.map(readMetaId).filter(Boolean);
  if (oldIds.length && newIds.length) {
    for (const id of oldIds) {
      if (!(id in newById)) continue;
      const oldIdx = oldById[id]?.index ?? -1;
      const newIdx = newById[id]?.index ?? -1;
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        mutations.push({
          type: "TREE_MOVE_SAME_LEVEL",
          pathBefore: [...pathBase, li(oldIdx)],
          path: [...pathBase, li(newIdx)],
          targetUniqueName: id,
          parentUniqueNameBefore: readMetaId(parentBefore),
          parentUniqueNameAfter: readMetaId(parentAfter)
        });
      }
    }
  }
  return mutations;
}
function diffMap(oldMap, newMap, basePath, parentBefore, parentAfter) {
  const mutations = [];
  const keys = /* @__PURE__ */ new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]);
  for (const key of keys) {
    const oldVal = (oldMap || {})[key];
    const newVal = (newMap || {})[key];
    const path = [...basePath, mk(key)];
    if (oldVal === void 0 && newVal !== void 0) {
      mutations.push({
        type: "OBJECT_ADD",
        path,
        valueAfter: newVal,
        targetUniqueName: readMetaId(newVal),
        parentUniqueNameAfter: readMetaId(parentAfter)
      });
      continue;
    }
    if (oldVal !== void 0 && newVal === void 0) {
      mutations.push({
        type: "OBJECT_DELETE",
        path,
        valueBefore: oldVal,
        targetUniqueName: readMetaId(oldVal),
        parentUniqueNameBefore: readMetaId(parentBefore)
      });
      continue;
    }
    if (!isEqual(oldVal, newVal)) {
      const nested = diffNodes(oldVal, newVal, path);
      if (nested.length === 0) {
        mutations.push({ type: "OBJECT_UPDATE", path, valueAfter: newVal });
      } else {
        mutations.push(...nested);
      }
    }
  }
  return mutations;
}
function diffExtend(oldExtend, newExtend, basePath, parentBefore, parentAfter) {
  const mutations = [];
  const parentId = readMetaId(parentAfter) ?? readMetaId(parentBefore);
  const pathBase = parentId ? [ms("id", parentId), ip("extend")] : basePath;
  const oldChildren = oldExtend?.children ?? {};
  const newChildren = newExtend?.children ?? {};
  const allTags = /* @__PURE__ */ new Set([...Object.keys(oldChildren), ...Object.keys(newChildren)]);
  for (const tag of allTags) {
    const oldChild = oldChildren[tag];
    const newChild = newChildren[tag];
    const childPath = [...pathBase, mk(tag)];
    if (!oldChild && newChild) {
      mutations.push({
        type: "TREE_ADD",
        path: childPath,
        valueAfter: newChild,
        targetUniqueName: readMetaId(newChild),
        parentUniqueNameAfter: readMetaId(parentAfter)
      });
      continue;
    }
    if (oldChild && !newChild) {
      mutations.push({
        type: "TREE_DELETE",
        path: childPath,
        valueBefore: oldChild,
        targetUniqueName: readMetaId(oldChild),
        parentUniqueNameBefore: readMetaId(parentBefore)
      });
      continue;
    }
    if (oldChild && newChild) {
      const nested = diffNodes(oldChild, newChild, childPath);
      if (nested.length === 0) {
        if (!isEqual(oldChild, newChild)) {
          mutations.push({ type: "TREE_UPDATE", path: childPath, valueAfter: newChild });
        }
      } else {
        mutations.push(...nested);
      }
    }
  }
  const oldOrder = oldExtend?.order ?? [];
  const newOrder = newExtend?.order ?? [];
  if (!isEqual(oldOrder, newOrder)) {
    mutations.push({
      type: "TREE_UPDATE",
      path: [...basePath, ip("order")],
      valueAfter: newOrder
    });
  }
  return mutations;
}
function sameKind(a, b) {
  if (isDataElement2(a) && isDataElement2(b)) return true;
  if (isTextElement2(a) && isTextElement2(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return true;
  if (isPlainObject3(a) && isPlainObject3(b)) return true;
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
  if (isPlainObject3(a) && isPlainObject3(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => isEqual(a[key], b[key]));
  }
  return false;
}
function isPlainObject3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isDataElement2(value) && !isTextElement2(value) && !isWord(value);
}
function isDataElement2(node) {
  return node && node.kind === "DataElement";
}
function isTextElement2(node) {
  return node && node.kind === "TextElement";
}
function isValueLiteral(node) {
  return typeof node === "string" || typeof node === "number" || typeof node === "boolean" || node === null || isWord(node);
}
function isComment2(node) {
  return node && node.kind === "Comment";
}
var ip = (value) => ({ type: "InstanceProperty", value });
var mk = (value) => ({ type: "MapKey", value });
var li = (value) => ({ type: "ListIndex", value: String(value) });
function ms(key, value) {
  return { type: "MetadataSelector", value: `{${key}=${JSON.stringify(value)}}` };
}
function readMetaId(node) {
  if (isDataElement2(node) || isTextElement2(node)) {
    const metaId = node.metadata?.id;
    if (typeof metaId === "string") return metaId;
  }
  return void 0;
}
function extractByMetaId(root, id) {
  if (Array.isArray(root)) {
    const idx = root.findIndex((item) => readMetaId(item) === id);
    if (idx !== -1) {
      const [removed] = root.splice(idx, 1);
      return removed;
    }
    for (const item of root) {
      const found = extractByMetaId(item, id);
      if (found !== void 0) return found;
    }
  } else if (isDataElement2(root)) {
    if (root.body) {
      const idx = root.body.findIndex((item) => readMetaId(item) === id);
      if (idx !== -1) {
        const [removed] = root.body.splice(idx, 1);
        return removed;
      }
      for (const child of root.body) {
        const found = extractByMetaId(child, id);
        if (found !== void 0) return found;
      }
    }
    if (root.extend) {
      const tags = [...root.extend.order];
      for (const tag of tags) {
        const child = root.extend.children[tag];
        if (readMetaId(child) === id) {
          delete root.extend.children[tag];
          root.extend.order = root.extend.order.filter((t) => t !== tag);
          return child;
        }
        const found = extractByMetaId(child, id);
        if (found !== void 0) return found;
      }
    }
  }
  return void 0;
}
function reconcileMoves(mutations) {
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
  const usedAdds = /* @__PURE__ */ new Set();
  const usedDeletes = /* @__PURE__ */ new Set();
  for (const [id, dels] of Object.entries(deletesById)) {
    const adds = addsById[id];
    if (!adds || adds.length === 0) continue;
    const del = dels[0];
    const add = adds[0];
    usedAdds.add(add);
    usedDeletes.add(del);
    const sameParent = add.parentUniqueNameAfter && del.parentUniqueNameBefore && add.parentUniqueNameAfter === del.parentUniqueNameBefore;
    const type = sameParent ? "TREE_MOVE_SAME_LEVEL" : "TREE_MOVE_CROSS_LEVEL";
    const move = {
      type,
      path: add.path,
      pathBefore: del.path,
      targetUniqueName: id,
      parentUniqueNameBefore: del.parentUniqueNameBefore,
      parentUniqueNameAfter: add.parentUniqueNameAfter
    };
    result.push(move);
  }
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
  return filtered;
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
  if (isPlainObject4(node)) {
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
    if (isPlainObject4(resolvedValue) && isPlainObject4(result[key])) {
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
      if (isPlainObject4(baseVal) && isPlainObject4(resolved)) {
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
function isPlainObject4(value) {
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
  if (isPlainObject4(value)) {
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
  path: {
    parse: parsePath,
    resolve: resolvePath,
    set: setPathValue,
    delete: deleteAtPath
  },
  mutation: {
    apply: applyMutations,
    diff: diffNodes
  },
  loader: {
    loadFromString,
    loadNode: resolveNode,
    batchLoad
  }
};

export { GetWordFullName, MakeWord, XNL, XnlParseError, XnlPathError, applyMutations, batchLoad, deleteAtPath, diffNodes, isWord, loadFromString, resolveNode as loadNode, parsePath, parseUniqueChildren, parseXnl, parseXnlSingleNode, resolvePath, setPathValue, wordToString };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map