# 变更：Add XNL formatter and unified XNL API

## 背景和动机 (Context And Why)
Consumers need a JSON.stringify-like formatter for XNL plus a single XNL namespace wrapping the parse helpers for clarity and ease of use across front/back ends.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Add `XNL.stringify` with single-line output by default and configurable pretty-printed formatting.
- Provide `XNL.parseMulti`, `XNL.parseSingle`, and `XNL.parseUnique` wrappers around existing parse helpers.
- Document formatting rules (attributes, bodies, raw/text preservation, indent behavior) and new API surface.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Add `XNL.stringify` with single-line output by default and configurable pretty-printed formatting.
- Provide `XNL.parseMulti`, `XNL.parseSingle`, and `XNL.parseUnique` wrappers around existing parse helpers.
- Document formatting rules (attributes, bodies, raw/text preservation, indent behavior) and new API surface.

## 影响范围（Impact）
- Affected specs: xnl-formatter (new), xnl-parser (modified for API wrappers)
- Affected code: formatter implementation, API facade, tests, docs/build export updates

## 迁移说明
- 原始归档日期：2025-11-24
- 原 OpenSpec change id：`add-xnl-formatter`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
