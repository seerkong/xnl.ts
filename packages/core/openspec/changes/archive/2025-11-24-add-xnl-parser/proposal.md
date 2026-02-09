# Change: XNL Parser Package

## Why
We need a reusable TypeScript/Node parser for the XNL format so frontends and backends can consume structured XNL documents defined in `doc/ai-guide/XnlLang.md`.

## What Changes
- Add an XNL parser API that converts XNL strings into a typed AST covering maps `{>`, arrays `[>`, unique child lists `{[>`, raw code `(>`, and plain text `>` bodies.
- Support XNL attribute forms for nested objects `{}`, arrays `[]`, and expression literals `(...)`, plus raw code blocks that pass through unchanged.
- Provide package entry points (types + runtime) suitable for browser and server use, with tests covering happy paths and validation failures.
- Surface structural validation (mismatched tags, invalid content types, duplicate child names in `{[>` blocks) with actionable errors.

## Impact
- Affected specs: xnl-parser (new capability)
- Affected code: parser implementation, AST typing, package build config, tests
