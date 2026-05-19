# Track Spec: update-xnl-parse-many

## 概述

本归档由 OpenSpec archived change `update-xnl-parse-many` 转换而来，保留原始归档日期 2025-11-24。
以下能力规范增量按 capability 分组，并保持原 OpenSpec delta 内容。

## Capability: xnl-formatter

## ADDED Requirements
### Requirement: XNL namespace availability
The formatter package SHALL expose the `XNL` namespace alongside `stringify`, with parse helpers named `parseMany`, `parseSingle`, and `parseUnique` to mirror parser capabilities.

#### Scenario: Namespace uses parseMany
- **WHEN** consumers import the XNL namespace
- **THEN** they find `parseMany`, `parseSingle`, `parseUnique`, and `stringify` as the supported API surface

## Capability: xnl-parser

## MODIFIED Requirements
### Requirement: Package distribution
The project SHALL expose the parser and AST types via a package consumable from both Node and browser environments, providing ESM and CJS entry points and generated TypeScript declarations.

#### Scenario: Package importable with types
- **WHEN** consumers install the package
- **THEN** they can import `parseXnl` and AST types from the package root in ESM or CJS projects with `.d.ts` available

#### Scenario: Namespaced parse helpers
- **WHEN** consumers prefer a single namespace
- **THEN** they can call `XNL.parseMany`, `XNL.parseSingle`, and `XNL.parseUnique` which delegate to existing parse helpers and surface warnings, in addition to the existing direct functions
