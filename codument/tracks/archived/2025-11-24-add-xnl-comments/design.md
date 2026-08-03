# Design: add-xnl-comments

> Converted from archived OpenSpec design. Original archive date: 2025-11-24.

## Context
XNL currently lacks comments. We want XML-style `<!-- ... -->` comments that can appear between nodes and in text-friendly bodies, ignored by the parser output, but preserved by the formatter when present.

## Goals / Non-Goals
- Goals: recognize/skip comments during parse; ensure formatter can round-trip comments in place for both compact and pretty output; document grammar changes.
- Non-Goals: nested comment syntax, different comment delimiters, or comment nodes affecting AST.

## Decisions
- Treat comments as ignorable tokens: parser skips them while maintaining whitespace/dedent semantics for text/raw bodies.
- Formatter will accept optional comment placeholders in the AST (if stored) or regenerate from parsed positions; minimal approach: retain comments encountered in text segments as-is when pretty/compact formatting.
- Grammar update to include `Comment = \"<!--\" ... \"-->\"` allowed between nodes and inside text/raw bodies.

## Risks / Trade-offs
- Preserving exact comment placement may complicate formatter; initial scope can emit comments inline as encountered while serializing nodes in order.

## Open Questions
- Should comments be preserved as explicit AST nodes or removed? Default: ignore in parse result but formatter should support emitting if we choose to store them.
