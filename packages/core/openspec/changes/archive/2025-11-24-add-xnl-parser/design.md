## Context
We need a reusable XNL parser that follows `doc/ai-guide/XnlLang.md`. The package should be usable in both browser and Node runtimes with TypeScript types. There is no formatter scope for this iteration.

## Goals / Non-Goals
- Goals: parse XNL strings into a typed AST; enforce content-type rules; surface helpful errors; ship an installable package with types for front/back usage.
- Non-Goals: formatting/pretty-printing; code execution/evaluation of expressions; schema validation beyond XNL structural rules.

## Decisions
- **AST shape:** Each element node carries `name`, `type` (`map`, `array`, `uniqueChildren`, `raw`, `text`, `void`), `attributes`, and `body`, with type names `MapContentElementNode`, `ArrayContentElementNode`, `UniqueElementNode`, `RawElementNode`, `TextElementNode`, and `VoidNode` to distinguish tagged elements from literal object/array values. Body varies by type: object map, array of values/nodes, record of child nodes keyed by tag (and stored in order), raw string, or plain text string. Attributes allow `string | number | boolean | object | array | expression | rawText`.
- **Parsing strategy:** Single-pass tokenizer that recognizes tags `<name ... start>` and closing markers, maintaining a stack to enforce pairing and body constraints. For `{[>` blocks, track duplicate child names, push a programmatic warning, and overwrite earlier entries. Text/raw bodies that span multiple lines dedent using the closing tag’s indentation (drop leading blank line, then trim that prefix from each line), akin to C# triple-quoted string indentation handling.
- **Value parsing:** Attribute helpers parse `{}` into nested records, `[]` into arrays, `( )` into an `ExpressionValue` (raw string), and `<(marker?>...<marker?)name>` into `RawTextValue` with the interior preserved verbatim; `marker` is optional `[A-Za-z_-]+` and must match on both sides. JSON-like literals (`true`/`false`, `null`, numbers) are coerced to native types with integer vs float kind retained from syntax; other bare identifiers become strings unless quoted. Body parsing for `{>` and `[>` uses similar tokenization constrained to key/value or array items with the same literal decoding rules.
- **Error handling:** Throw structured errors with code + message when encountering mismatched tags, invalid body content (e.g., text inside `[>`), malformed attribute literals, or duplicate names in `{[>`.
- **Packaging:** TypeScript source with `tsup` (or `tsc` if lighter) to emit ESM + CJS builds and `.d.ts`, exposing `parseXnl` and AST types from the package root for browser/Node consumption.

## Risks / Trade-offs
- Hand-rolled parsing requires careful delimiter handling; mitigate with unit tests covering mixed nesting and edge cases.
- Expression bodies are left as raw strings; consumers must validate/evaluate separately, which keeps parser scope small but may defer errors downstream. Raw blocks rely on matching optional markers to delimit content. Numeric literals keep kind metadata (integer vs float) even though the JS runtime uses `number`; future non-JS targets can map to long/double as needed. Multiline text/raw bodies dedent based on closing indentation to support pleasant formatting. `{[>` duplicate children warn and overwrite earlier nodes.

## API Notes
- Provide helpers: `parseXnlSingleNode` (returns `{ node, warnings }`, errors on trailing content) and `parseUniqueChildren(name, input, attrs?)` (returns `{ node, warnings }`) to construct a `uniqueChildren` node from sibling elements, applying duplicate overwrite + warning semantics. `parseXnl` returns `{ nodes, warnings }` so consumers can capture warnings programmatically.
- `{[>` nodes enforce uniqueness by name; documents relying on repeated tags will error—intentional per spec.

## Open Questions
- Is there a required error code format for consumers, or are message strings sufficient? Plan: minimal codes with human-readable messages unless specified otherwise.
