# 变更：Add XNL path/mutation/loader protocols

## 背景和动机 (Context And Why)
We need path-based access, mutation application/diffing, and prototype-style loading for the XNL AST so that existing dslsuite workflows can be supported in this TypeScript implementation while honoring XNL’s available constructs.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Introduce a path protocol for parsing and resolving path strings against XNL nodes (metadata, attributes, body, extend children).
- Add a mutation protocol that applies/diffs mutations using the path protocol, scoped to XNL features (no xnl not supported structures).
- Provide a dataloader that honors system metadata fields (proto/extend/export/remove) to resolve prototypes and overrides using XNL nodes and `.xnl` resources.
- Add tests and fixtures under `tests/resources` to validate the new protocols.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Introduce a path protocol for parsing and resolving path strings against XNL nodes (metadata, attributes, body, extend children).
- Add a mutation protocol that applies/diffs mutations using the path protocol, scoped to XNL features (no xnl not supported structures).
- Provide a dataloader that honors system metadata fields (proto/extend/export/remove) to resolve prototypes and overrides using XNL nodes and `.xnl` resources.
- Add tests and fixtures under `tests/resources` to validate the new protocols.

## 影响范围（Impact）
- Affected specs: xnl-path, xnl-mutation, xnl-loader (new).
- Affected code: new `path/`, `mutation/`, `loader/` modules plus exports and fixtures in tests/resources.

## 迁移说明
- 原始归档日期：2025-12-07
- 原 OpenSpec change id：`add-xnl-path-mutation-loader`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
