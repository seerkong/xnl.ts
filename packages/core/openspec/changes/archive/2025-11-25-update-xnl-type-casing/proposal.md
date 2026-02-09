# Change: Update XNL AST string enums to PascalCase

## Why
Current AST string constants (node body types, value kinds, numeric kinds) use lowerCamel casing, which is inconsistent with typical enum-style naming and complicates downstream consumption that expects PascalCase values.

## What Changes
- Change `NodeBodyType`, `NumericKind`, and value `kind` string literals to PascalCase.
- Update parser/formatter/tests and docs to consume the new casing.
- Maintain API surface but treat this as a breaking value change with migration guidance.

## Impact
- Affected specs: xnl-parser (AST value naming).
- Affected code: `src/types.ts`, parser/formatter logic, tests, AI guides referencing kind strings.
