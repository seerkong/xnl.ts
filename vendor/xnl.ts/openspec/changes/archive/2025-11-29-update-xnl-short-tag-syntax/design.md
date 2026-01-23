## Context
- Need a short-form XNL syntax optimized for prompts: short closers (`}>`, `]>`, `)>`, `<#>`), inline metadata, and multi-section nodes.
- Parentheses are repurposed from expression literals to unique-child sections; raw markers and `(expr)` values disappear.

## Goals / Non-Goals
- Goals: define concrete grammar, AST shape, and formatter rules for short tags; keep duplicate-child overwrite semantics for extend blocks; preserve numeric kind metadata.
- Non-Goals: backward compatibility with the old `{>`, `[>`, `(>` grammar; mixed text + structural sections in a single node.

## Decisions
- **Node sections:** A node may carry inline `metadata` (key/value pairs right after the name), optional `attributes` from a `{ ... }` block, optional array `body` from `[ ... ]`, optional unique-child `extend` from `( ... )`, and optional `text` from `#` blocks. Text blocks are exclusive with arrays/extend: when `#` is used, `[]` and `()` are disallowed, but inline metadata and `{}` attributes are allowed (e.g., `<note a=1 {b=2} #> ... <#>`).
- **Closers:** Map/array/extend sections close with `}>`, `]>`, `)>` (the final `>` ends the tag). Text blocks use `<#marker?>` paired with `<name#marker?>` start. Void nodes end with `>`.
- **Values:** `ValueLiteral` is primitive-only (`String`/`Boolean`/`Null`/`Number` with numericKind). Objects/arrays/metadata/attributes map keys to `XnlNode`, so entries/items can be values, objects/arrays, element nodes, or comments. Allow single or double quotes for strings (keys may be quoted). Remove expression literals and `<(raw)>` literals; use text blocks for unescaped spans.
- **Extend uniqueness:** `( ... )` must contain tags only; duplicate tag names overwrite earlier ones and emit a warning, preserving order with overwrite semantics.
- **Dedent:** Multiline text content drops a leading blank line and dedents by the closing `<#...>` indentation (spaces/tabs).
- **Comments:** `<!-- -->` allowed anywhere whitespace is allowed; skipped in AST and stripped from text/extend sections.
- **Formatter ordering:** Emit sections in source order: metadata on the start tag, then `{}`, then `[]`, then `()`; text nodes emit `<name#marker?> ... <#marker?>` and may include metadata/`{}` before `#`.

## Risks / Trade-offs
- Breaking change: old syntax no longer parses; requires doc/test updates.
- Removing expression/raw literals may reduce expressiveness; mitigated by text blocks for raw spans.

## Open Questions
- Should inline metadata be allowed on text tags (e.g., `<note a=1 #>`)? Yes, allowed; `{}` attributes also allowed on text tags, but `[]`/`()` are not.
