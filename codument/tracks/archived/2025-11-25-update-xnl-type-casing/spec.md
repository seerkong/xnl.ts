# Track Spec: update-xnl-type-casing

## 概述

本归档由 OpenSpec archived change `update-xnl-type-casing` 转换而来，保留原始归档日期 2025-11-25。
以下能力规范增量按 capability 分组，并保持原 OpenSpec delta 内容。

## Capability: xnl-parser

## MODIFIED Requirements
### Requirement: Parse XNL documents
The system SHALL parse XNL strings into an AST where each element node includes its tag name, attributes, body type (`Map`, `Array`, `UniqueChildren`, `Raw`, `Text`, or `Void`), and typed body content determined by the opening delimiter (`{>`, `[>`, `{[>`, `(>`, `>`, or self-closing). Element node type names for tagged nodes SHALL be `MapContentElementNode`, `ArrayContentElementNode`, `UniqueElementNode`, `RawElementNode`, `TextElementNode`, and `VoidNode` to distinguish them from literal object/array value nodes.

#### Scenario: Mixed content parsed to AST
- **WHEN** a document containing map, array, unique-children, raw-code, text, and self-closing nodes is parsed
- **THEN** each node in the AST reflects the correct body type and preserves order and nesting

### Requirement: Attribute value decoding
The parser SHALL decode attribute values according to XNL syntax: `{...}` → nested object, `[...]` → array, `(...)` → expression value kept as a raw string, `<(>...<)name>` → raw text value, and JSON-style bare literals (`true`/`false`, `null`, numbers) coerced to native types while other bare identifiers become strings; malformed attribute literals are rejected. Value `kind` strings SHALL be PascalCase: `String`, `Boolean`, `Null`, `Number` (with numeric kind `Integer`|`Float`), `Expression`, `Raw`, `Object`, `Array`.

#### Scenario: Structured attributes parsed
- **WHEN** attributes include nested objects, arrays, expression wrappers, and raw code blocks
- **THEN** the parsed attribute map contains typed values reflecting those structures

#### Scenario: JSON literals coerced
- **WHEN** attributes use bare literals like `id=123` (integer) or `rate=2.5` (float) or `active=false`
- **THEN** the parser returns numbers for `id`/`rate` (with numeric kind preserved as `Integer` or `Float`) and a boolean for `active` without requiring quotes

#### Scenario: Malformed attribute literal errors
- **WHEN** an attribute literal is missing closing delimiters or uses mixed delimiters incorrectly
- **THEN** the parser raises an error describing the malformed attribute
