# 变更：Align loader and mutation with dslsuite parity

## 背景和动机 (Context And Why)
- Current loader/mutation behavior diverges from the dslsuite implementation and its test suite, causing missing prototype resolution, remove markers, and tree/object mutation fidelity.
- dslsuite is the reference behavior; XNL must match it for downstream parity and to make mutation/apply a reliable foundation for future features.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Loader: support typed prefab sections (e.g., `DslBPrefabs`), scoped prefab lookup, and nested map/array removals via `<delta remove=true>` when merging prototypes.
- Mutation: add move detection (same-level and cross-level) based on `metadata.id`, include dslsuite-style mutation fields, and update diff/apply logic accordingly.
- Keep path syntax as-is (no namespace/static segments), but ensure mutation diff/apply leverages `metadata.id` for stable identity.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Loader: support typed prefab sections (e.g., `DslBPrefabs`), scoped prefab lookup, and nested map/array removals via `<delta remove=true>` when merging prototypes.
- Mutation: add move detection (same-level and cross-level) based on `metadata.id`, include dslsuite-style mutation fields, and update diff/apply logic accordingly.
- Keep path syntax as-is (no namespace/static segments), but ensure mutation diff/apply leverages `metadata.id` for stable identity.

## 影响范围（Impact）
- Affected specs: xnl-loader, xnl-mutation
- Affected code: loader prototype collection/merge, remove handling, mutation diff/apply (including types), related tests/fixtures

## 迁移说明
- 原始归档日期：2025-12-07
- 原 OpenSpec change id：`update-loader-mutation-parity`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
