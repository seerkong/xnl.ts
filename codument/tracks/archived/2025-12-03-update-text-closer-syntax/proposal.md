# 变更：Use slash-prefixed text closers `</#...>`

## 背景和动机 (Context And Why)
- Some AI sources keep emitting `</#>` to close text blocks while the current syntax expects `<#>`, leading to parse errors and brittle round-trips.
- Aligning the syntax to the slash-prefixed closer should reduce generation mistakes and make the grammar more conventional.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Switch text block closing tags to `</#>` / `</#marker>` across the parser, formatter, and grammar.
- Reject the legacy `<#>` / `<#marker>` closers and update error messaging and dedent rules to match.
- Update specs, EBNF, and tests to reflect the new closing tag syntax.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Switch text block closing tags to `</#>` / `</#marker>` across the parser, formatter, and grammar.
- Reject the legacy `<#>` / `<#marker>` closers and update error messaging and dedent rules to match.
- Update specs, EBNF, and tests to reflect the new closing tag syntax.

## 影响范围（Impact）
- Affected specs: xnl-parser, xnl-formatter
- Affected code: parser text-body parsing, formatter emission, text block validation/dedent, related tests and fixtures

## 迁移说明
- 原始归档日期：2025-12-03
- 原 OpenSpec change id：`update-text-closer-syntax`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
