# Track Spec: add-xnl-formatter

## 概述

本归档由 OpenSpec archived change `add-xnl-formatter` 转换而来，保留原始归档日期 2025-11-24。
以下能力规范增量按 capability 分组，并保持原 OpenSpec delta 内容。

## Capability: xnl-formatter

## ADDED Requirements
### Requirement: XNL stringify API
The system SHALL provide `XNL.stringify(value, options?)` that serializes an XNL AST (`XnlDocument` or `XnlNode`) into a valid XNL string. The default output is compact single-line; when `options.pretty` is true, output is pretty-printed using an `indent` option (number of spaces or string).

#### Scenario: Compact stringify
- **WHEN** `XNL.stringify` is called without options
- **THEN** the returned string is a single line with minimal spaces and can be parsed back to an equivalent AST

#### Scenario: Pretty stringify with indent
- **WHEN** `XNL.stringify` is called with `{ pretty: true, indent: 2 }`
- **THEN** map entries, array items, and child elements are split onto new lines with the given indentation per nesting level while preserving order

#### Scenario: Raw/text preservation
- **WHEN** nodes contain text or raw bodies (including markers)
- **THEN** `XNL.stringify` emits the bodies without altering their content beyond existing dedent rules and preserves matching markers and closing tags

### Requirement: AST ordering and determinism
The formatter SHALL preserve node order (document nodes, unique-children order array, array items order) and attribute iteration order when serializing.

#### Scenario: Stable output
- **WHEN** serializing the same AST twice
- **THEN** the outputs are identical strings

### Requirement: Attribute and literal emission
The formatter SHALL emit attributes and literal values according to XNL syntax: objects as `{ key = value }`, arrays as `[ ... ]`, expressions as `(expr)`, raw literals with markers retained, and numbers/booleans/null/strings rendered canonically; numeric kind metadata does not change emitted syntax beyond integer vs float representation.

#### Scenario: Attribute literals preserved
- **WHEN** attributes include nested objects/arrays, expressions, raw literals, and numeric kinds
- **THEN** `XNL.stringify` emits syntactically correct XNL that round-trips to equivalent literals

## Capability: xnl-parser

## MODIFIED Requirements
### Requirement: Package distribution
The project SHALL expose the parser and AST types via a package consumable from both Node and browser environments, providing ESM and CJS entry points and generated TypeScript declarations.

#### Scenario: Package importable with types
- **WHEN** consumers install the package
- **THEN** they can import `parseXnl` and AST types from the package root in ESM or CJS projects with `.d.ts` available

#### Scenario: Namespaced parse helpers
- **WHEN** consumers prefer a single namespace
- **THEN** they can call `XNL.parseMulti`, `XNL.parseSingle`, and `XNL.parseUnique` which delegate to existing parse helpers and surface warnings, in addition to the existing direct functions
