# XNL Parser (TypeScript)

Node + browser-friendly parser for the XNL (Extensible Notation Language) format described in `doc/ai-guide/XnlDataFormatIntroduce.md`.

## Install

```bash
npm install xnl-core
```

## Usage

```ts
import { XNL, parseXnl, stringify } from "xnl-core";

// Parse many
const { nodes, warnings } = XNL.parseMany(`<item a=1 { b = 2 } [ 3 4 ]>`);

// Parse one
const { node } = XNL.parseSingle(`<text a=1 {b=2} #>hello</#>`);

// Unique children (extend-like)
const { node: unique } = XNL.parseUnique("root", `<a {x=1}> <a {x=2}> <b>`);

// Stringify (compact by default)
const compact = stringify({ nodes });

// Pretty stringify
const pretty = XNL.stringify({ nodes }, { pretty: true, indent: 2 });
```

## API

- `parseXnl(input: string): XnlDocument` – parse a full XNL string into an AST of nodes plus optional `warnings`.
- `parseXnlSingleNode(input: string): { node: XnlNode; warnings?: ParseWarning[] }` – parse exactly one node; errors if extra content remains.
- `parseUniqueChildren(name: string, input: string, metadata?: AttributeMap, attributes?: AttributeMap): { node: XnlNode; warnings?: ParseWarning[] }` – parse multiple sibling elements into a node whose `extend` children overwrite duplicates with a warning.
- `XNL` namespace: `XNL.parseMany`, `XNL.parseSingle`, `XNL.parseUnique` (wrappers around the above) and `XNL.stringify`.
- `XNL.stringify(value: XnlDocument | XnlNode, options?)` – serialize a document or node to XNL. Defaults to compact single-line; pass `{ pretty: true, indent: 2 }` (or string indent) for pretty output.
- AST nodes carry `tag`, `metadata` (inline `key=value`), optional `{}` `attributes`, optional `body` array (`[]` block), optional unique `extend` children (`()` block with warn+overwrite on duplicate tag names), and optional `text`/`textMarker` for `<tag ... #>...</#...>`.
- `ValueLiteral` is primitive-only (`String`/`Boolean`/`Null`/`Number`). `ObjectValue.entries`, `ArrayValue.items`, `metadata`/`attributes`, and `body` all hold `XnlNode`, so object/array/attribute entries can themselves be elements, values, or comments.
- Value literals keep numeric kind metadata (`Integer` vs `Float`) while using `number` values in JS/TS.
- Multiline text blocks dedent like C# triple-quoted strings: drop a leading blank line, then strip the closing tag’s indentation prefix (spaces/tabs) from each line.

### Errors

Errors are thrown as `XnlParseError` with `code`, line/column, and tag/marker context in the message:

- `UNEXPECTED_EOF` – input ended before a structure closed (message names the tag/delimiter).
- `MISMATCHED_TAG` – closing text marker did not match opener (message shows expected vs found).
- `DUPLICATE_CHILD` – extend `( ... )` block repeated a child name (later overwrote earlier).
- `INVALID_CONTENT` – disallowed content for the current body type (e.g., text with `[]`/`()`), message cites parent tag.
- `INVALID_LITERAL` – malformed or unsupported literal.
- `UNEXPECTED_TOKEN` – unexpected character while parsing.
- Warnings (returned, not logged): `DUPLICATE_CHILD` when extend children repeat names (later overwrites earlier).

Example:

```ts
import { parseXnl, XnlParseError } from "xnl-core";

try {
  parseXnl("<wrap ( <a> <a> )>");
} catch (err) {
  const e = err as XnlParseError;
  console.error(e.code, e.message); // DUPLICATE_CHILD ...
}
```
