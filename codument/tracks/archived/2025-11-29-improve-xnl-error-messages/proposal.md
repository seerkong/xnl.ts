# 变更：improve parser error messaging

## 背景和动机 (Context And Why)
- Current parser errors lack actionable detail for end users; unclear which tag or position failed.
- Users want explicit messages pointing to the problem location (e.g., which tag was not closed).

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Enhance XNL parser to surface descriptive syntax errors with location and offending tag/token context.
- Update specs, docs, and tests to cover detailed error messaging for common failures (unclosed tags, mismatched markers, invalid blocks).

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Enhance XNL parser to surface descriptive syntax errors with location and offending tag/token context.
- Update specs, docs, and tests to cover detailed error messaging for common failures (unclosed tags, mismatched markers, invalid blocks).

## 影响范围（Impact）
- Affected specs: xnl-parser
- Affected code: parser error handling, documentation, tests

## 迁移说明
- 原始归档日期：2025-11-29
- 原 OpenSpec change id：`improve-xnl-error-messages`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
