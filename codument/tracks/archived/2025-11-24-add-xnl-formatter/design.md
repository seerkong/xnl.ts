# Design: add-xnl-formatter

> Converted from archived OpenSpec design. Original archive date: 2025-11-24.

## Context
We need a formatter for XNL that mirrors JSON.stringify-style API surface, plus a unified XNL namespace that wraps existing parse helpers. Formatting must respect XNL grammar (body types, raw/text dedent rules, attribute literals).

## Goals / Non-Goals
- Goals: deterministic stringify (compact by default, optional pretty), programmatic parse wrappers under `XNL.*`, keep output parseable by current parser.
- Non-Goals: custom replacer/serializer logic beyond indent/spacing; schema-aware formatting; changing parse semantics.

## Decisions
- **API shape:** Expose `XNL.stringify(value, options?)` where value can be an `XnlDocument | XnlNode`; options include `pretty` (boolean) and `indent` (number|string). Keep defaults to single-line, minimal spaces.
- **Ordering:** Preserve node order as stored (unique children order array, array items order); attributes emit in insertion order (object iteration order).
- **Literals:** Preserve numeric kind metadata where available but emit as canonical numbers; strings quoted; booleans/null as keywords; expression/raw/text bodies emitted as-is (respecting markers and dedent rules—no additional trimming besides existing dedent).
- **Indentation rules:** Compact mode: no newlines, minimal spaces. Pretty mode: newline + indent per nesting level for children/arrays/maps; body-specific formatting (e.g., map entries one per line when pretty).
- **Raw/text:** Do not alter content other than already-dedented body; ensure markers and closing tags are symmetric.
- **Parse wrappers:** Add `XNL.parseMulti` -> existing `parseXnl`, `XNL.parseSingle` -> `parseXnlSingleNode`, `XNL.parseUnique` -> `parseUniqueChildren`.

## Risks / Trade-offs
- Pretty formatting choices may not satisfy all consumers; mitigate by keeping options minimal and deterministic.
- Attribute ordering depends on JS object property order; acceptable for initial version.

## Open Questions
- Should we support a replacer-like callback for stringify? (Default: no, keep scope small.)
- Should pretty mode include trailing newlines? (Default: no trailing newline.)***
