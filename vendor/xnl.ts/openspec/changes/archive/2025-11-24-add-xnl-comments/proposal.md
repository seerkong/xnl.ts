# Change: Support XNL comments

## Why
We need XML-style comments (`<!-- ... -->`) in XNL documents for inline notes without affecting parsed structures.

## What Changes
- Extend the XNL grammar and parser to recognize and ignore `<!-- comment -->` blocks between nodes/inside bodies where text is allowed.
- Ensure formatter emits comments when present and preserves their placement relative to nodes/content.
- Document the updated grammar in `openspec/specs/xnl-parser/spec.md`.

## Impact
- Affected specs: xnl-parser (comment syntax), xnl-formatter (comment emission)
- Affected code: parser, formatter, types (if needed), tests, docs
