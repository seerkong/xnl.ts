# 变更：Short-tag XNL syntax

## 背景和动机 (Context And Why)
- Current XML-style opening/closing pairs are verbose for prompt and human-in-the-loop authoring.
- The new short form with `}>`/`]>`/`)>`/`<#>`/inline metadata reduces keystrokes and aligns better with quick prompt editing.
- `()` is being repurposed from expression literals to unique-child sections, so the grammar and AST must change.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Replace the existing XNL tag body delimiters with short-form closers (`}>`, `]>`, `)>`, `<#...>`), plus inline metadata vs block attributes.
- Redefine node structure to carry `metadata`, `attributes` (`{}` block), `body` (`[]` block), `extend` (`()` block with unique child tags), and `text` (`#` block with optional marker) simultaneously.
- Drop expression/`(expr)` attribute literals and old raw markers; allow single/double-quoted strings and quoted map keys.
- Update parser, formatter, AST types, EBNF, and documentation to the new syntax and behavior.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Replace the existing XNL tag body delimiters with short-form closers (`}>`, `]>`, `)>`, `<#...>`), plus inline metadata vs block attributes.
- Redefine node structure to carry `metadata`, `attributes` (`{}` block), `body` (`[]` block), `extend` (`()` block with unique child tags), and `text` (`#` block with optional marker) simultaneously.
- Drop expression/`(expr)` attribute literals and old raw markers; allow single/double-quoted strings and quoted map keys.
- Update parser, formatter, AST types, EBNF, and documentation to the new syntax and behavior.

## 影响范围（Impact）
- Affected specs: xnl-parser, xnl-formatter
- Affected code: parser, formatter, types, docs, tests

## 迁移说明
- 原始归档日期：2025-11-29
- 原 OpenSpec change id：`update-xnl-short-tag-syntax`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
