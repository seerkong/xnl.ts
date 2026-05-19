# 变更：XNL Parser Package

## 背景和动机 (Context And Why)
We need a reusable TypeScript/Node parser for the XNL format so frontends and backends can consume structured XNL documents defined in `doc/ai-guide/XnlLang.md`.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Add an XNL parser API that converts XNL strings into a typed AST covering maps `{>`, arrays `[>`, unique child lists `{[>`, raw code `(>`, and plain text `>` bodies.
- Support XNL attribute forms for nested objects `{}`, arrays `[]`, and expression literals `(...)`, plus raw code blocks that pass through unchanged.
- Provide package entry points (types + runtime) suitable for browser and server use, with tests covering happy paths and validation failures.
- Surface structural validation (mismatched tags, invalid content types, duplicate child names in `{[>` blocks) with actionable errors.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Add an XNL parser API that converts XNL strings into a typed AST covering maps `{>`, arrays `[>`, unique child lists `{[>`, raw code `(>`, and plain text `>` bodies.
- Support XNL attribute forms for nested objects `{}`, arrays `[]`, and expression literals `(...)`, plus raw code blocks that pass through unchanged.
- Provide package entry points (types + runtime) suitable for browser and server use, with tests covering happy paths and validation failures.
- Surface structural validation (mismatched tags, invalid content types, duplicate child names in `{[>` blocks) with actionable errors.

## 影响范围（Impact）
- Affected specs: xnl-parser (new capability)
- Affected code: parser implementation, AST typing, package build config, tests

## 迁移说明
- 原始归档日期：2025-11-24
- 原 OpenSpec change id：`add-xnl-parser`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
