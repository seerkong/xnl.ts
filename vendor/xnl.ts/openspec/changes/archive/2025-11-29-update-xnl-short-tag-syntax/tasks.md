## 1. Specification and design
- [x] 1.1 Finalize short-tag grammar and AST shape in design.md
- [x] 1.2 Update spec deltas for xnl-parser and xnl-formatter

## 2. Implementation
- [x] 2.1 Update types to new node sections (metadata/attributes/body/extend/text) and value literal rules
- [x] 2.2 Rework parser to new delimiters, inline metadata parsing, extend uniqueness, and text markers
- [x] 2.3 Adjust formatter to emit new short-tag syntax for all sections and text blocks
- [x] 2.4 Update documentation and examples to match new syntax

## 3. Verification
- [x] 3.1 Add/adjust tests for parser, formatter, and sample conversions
- [x] 3.2 Run `npm run test` and `npm run build`
