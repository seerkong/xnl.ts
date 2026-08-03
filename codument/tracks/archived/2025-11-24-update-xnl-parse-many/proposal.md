# 变更：Rename parseMulti to parseMany and update API/docs

## 背景和动机 (Context And Why)
The namespaced parse helper should expose `parseMany` (not `parseMulti`) to align with intended API and documentation, avoiding confusion for consumers.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Rename the namespaced multi-node parse helper to `XNL.parseMany` across code, exports, and tests.
- Update README and any examples to use `XNL.parseMany`.
- Align specs to reflect the corrected API name.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Rename the namespaced multi-node parse helper to `XNL.parseMany` across code, exports, and tests.
- Update README and any examples to use `XNL.parseMany`.
- Align specs to reflect the corrected API name.

## 影响范围（Impact）
- Affected specs: xnl-parser (API name), xnl-formatter (API references)
- Affected code: XNL namespace exports, tests, README/documentation

## 迁移说明
- 原始归档日期：2025-11-24
- 原 OpenSpec change id：`update-xnl-parse-many`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
