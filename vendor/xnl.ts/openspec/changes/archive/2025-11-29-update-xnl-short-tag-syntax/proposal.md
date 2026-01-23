# Change: Short-tag XNL syntax

## Why
- Current XML-style opening/closing pairs are verbose for prompt and human-in-the-loop authoring.
- The new short form with `}>`/`]>`/`)>`/`<#>`/inline metadata reduces keystrokes and aligns better with quick prompt editing.
- `()` is being repurposed from expression literals to unique-child sections, so the grammar and AST must change.

## What Changes
- Replace the existing XNL tag body delimiters with short-form closers (`}>`, `]>`, `)>`, `<#...>`), plus inline metadata vs block attributes.
- Redefine node structure to carry `metadata`, `attributes` (`{}` block), `body` (`[]` block), `extend` (`()` block with unique child tags), and `text` (`#` block with optional marker) simultaneously.
- Drop expression/`(expr)` attribute literals and old raw markers; allow single/double-quoted strings and quoted map keys.
- Update parser, formatter, AST types, EBNF, and documentation to the new syntax and behavior.

## Impact
- Affected specs: xnl-parser, xnl-formatter
- Affected code: parser, formatter, types, docs, tests
