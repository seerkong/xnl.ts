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

### Mutation preview

`diffNodes` and `applyMutations` remain the compatible low-level mutation
primitives. `applyMutations` mutates the root passed to it. For an isolated,
atomic authoring preview, use `dryRunMutations` or its
`XNL.mutation.dryRun`/`XNL.mutation.preview` facade aliases:

```ts
import {
  XNL,
  diffNodes,
  dryRunMutations,
  type XnlMutationBatchOptions,
} from "xnl-core";

const base = XNL.parseSingle(
  `<root #root [ <item #item {state="draft"}> ]>`,
).node;
const target = XNL.parseSingle(
  `<root #root [ <item #item {state="published"}> ]>`,
).node;
const mutations = diffNodes(base, target);
const options: XnlMutationBatchOptions = {
  verifyValueBefore: true,
  identityPolicy: "require-elements",
};
const result = dryRunMutations(base, mutations, options);
// Equivalent facade call:
const preview = XNL.mutation.preview(base, mutations, options);

if (result.status === "applied") {
  // result.value is the fully applied clone; base is unchanged.
  XNL.stringify(result.value);
} else {
  // result.value is an unchanged base clone, never a partially applied tree.
  console.error(result.diagnostics);
}
```

- Element `#id` is the identity key used to align snapshots, detect moves, and
  address mutation targets. It is not an ordinary updatable field.
- The strict dry-run API rejects hand-authored add/update/delete mutations that
  target an element `:id` with `IDENTITY_MUTATION_FORBIDDEN`. It also rejects
  whole-node or container update mutations that would add, remove, swap,
  relocate, or change the authority source for an identified element. Strict
  identity continuity compares the ordered full-tree identity skeleton before
  and after each update; replace identity by deleting the old node and adding a
  new node.
- Element `#id` still participates only in diff alignment, move detection, and
  target addressing. It is not emitted as ordinary mutation payload, even when
  `diffNodes` uses it to align a child or express a move.
- Assignment-style structural writes to an occupied property, map key, or
  extend child key reject with `IDENTITY_MUTATION_FORBIDDEN` when the destination
  contains an identified element. Ordinary array insertion and empty assignment
  destinations remain valid structural operations.
- Extend child reorder is structural. `diffNodes` emits explicit move mutations
  rather than `TREE_UPDATE ...:extend:order`; same-identity Extend retag uses
  the optional `destinationKey` mutation field to migrate the keyed child slot
  before the following payload update changes the child tag.
- `IDENTITY_MUTATION_FORBIDDEN` reports strict identity-continuity or occupied
  destination violations. `RESULT_STRUCTURE_INVALID` reports a final Extend
  body whose `order`, `children` keys, and child tags are incoherent.
- `identityPolicy` defaults to `"allow-missing"` while still rejecting duplicate
  effective identities. Use `"require-elements"` to require every data or text
  element to have an identity.
- With `verifyValueBefore: true`, delete, update, and move mutations that provide
  `valueBefore` are checked against the current observable target. A stale value
  rejects the batch with `PRECONDITION_FAILED`.
- A rejected batch leaves `base` unchanged and returns an isolated clone of the
  unchanged base. Partially applied candidate state is never exposed.

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
