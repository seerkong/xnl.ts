## MODIFIED Requirements
### Requirement: Package distribution
The project SHALL expose the parser and AST types via a package consumable from both Node and browser environments, providing ESM and CJS entry points and generated TypeScript declarations.

#### Scenario: Package importable with types
- **WHEN** consumers install the package
- **THEN** they can import `parseXnl` and AST types from the package root in ESM or CJS projects with `.d.ts` available

#### Scenario: Namespaced parse helpers
- **WHEN** consumers prefer a single namespace
- **THEN** they can call `XNL.parseMany`, `XNL.parseSingle`, and `XNL.parseUnique` which delegate to existing parse helpers and surface warnings, in addition to the existing direct functions
