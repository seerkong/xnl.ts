## 1. Implementation
- [x] 1.1 Define public parse API and AST/type definitions (aligning with XNL content types).
- [x] 1.2 Implement parsing of nodes and bodies for `{>`, `[>`, `{[>`, `(>`, and `>` blocks with structural validation.
- [x] 1.3 Parse attribute value forms `{ ... }`, `[ ... ]`, `( ... )`, raw blocks, and plain scalars into typed values.
- [x] 1.4 Preserve `(>` raw code content verbatim while still enforcing tag pairing.
- [x] 1.5 Export package entry points and build outputs usable in Node and browser environments with generated `.d.ts`.
- [x] 1.6 Add unit tests covering successful parses, error conditions (mismatched tags, duplicate child names, invalid mixes), and attribute parsing.
- [x] 1.7 Document the parser API and expected error semantics for initial consumers.
