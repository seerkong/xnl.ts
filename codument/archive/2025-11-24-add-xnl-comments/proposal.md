# 变更：Support XNL comments

## 背景和动机 (Context And Why)
We need XML-style comments (`<!-- ... -->`) in XNL documents for inline notes without affecting parsed structures.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Extend the XNL grammar and parser to recognize and ignore `<!-- comment -->` blocks between nodes/inside bodies where text is allowed.
- Ensure formatter emits comments when present and preserves their placement relative to nodes/content.
- Document the updated grammar in `openspec/specs/xnl-parser/spec.md`.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Extend the XNL grammar and parser to recognize and ignore `<!-- comment -->` blocks between nodes/inside bodies where text is allowed.
- Ensure formatter emits comments when present and preserves their placement relative to nodes/content.
- Document the updated grammar in `openspec/specs/xnl-parser/spec.md`.

## 影响范围（Impact）
- Affected specs: xnl-parser (comment syntax), xnl-formatter (comment emission)
- Affected code: parser, formatter, types (if needed), tests, docs

## 迁移说明
- 原始归档日期：2025-11-24
- 原 OpenSpec change id：`add-xnl-comments`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
