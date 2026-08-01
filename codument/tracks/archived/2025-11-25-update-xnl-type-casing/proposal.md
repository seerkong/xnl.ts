# 变更：Update XNL AST string enums to PascalCase

## 背景和动机 (Context And Why)
Current AST string constants (node body types, value kinds, numeric kinds) use lowerCamel casing, which is inconsistent with typical enum-style naming and complicates downstream consumption that expects PascalCase values.

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- Change `NodeBodyType`, `NumericKind`, and value `kind` string literals to PascalCase.
- Update parser/formatter/tests and docs to consume the new casing.
- Maintain API surface but treat this as a breaking value change with migration guidance.

**非目标:**
- 原 OpenSpec proposal 未记录额外非目标；迁移仅保留原归档变更语义，不扩大运行时代码范围。

## 变更内容（What Changes）
- Change `NodeBodyType`, `NumericKind`, and value `kind` string literals to PascalCase.
- Update parser/formatter/tests and docs to consume the new casing.
- Maintain API surface but treat this as a breaking value change with migration guidance.

## 影响范围（Impact）
- Affected specs: xnl-parser (AST value naming).
- Affected code: `src/types.ts`, parser/formatter logic, tests, AI guides referencing kind strings.

## 迁移说明
- 原始归档日期：2025-11-25
- 原 OpenSpec change id：`update-xnl-type-casing`
- 本文件按 Codument proposal 结构从 OpenSpec proposal 转换而来。
