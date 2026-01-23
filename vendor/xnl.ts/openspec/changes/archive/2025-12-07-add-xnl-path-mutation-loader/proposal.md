# Change: Add XNL path/mutation/loader protocols

## Why
We need path-based access, mutation application/diffing, and prototype-style loading for the XNL AST so that existing dslsuite workflows can be supported in this TypeScript implementation while honoring XNL’s available constructs.

## What Changes
- Introduce a path protocol for parsing and resolving path strings against XNL nodes (metadata, attributes, body, extend children).
- Add a mutation protocol that applies/diffs mutations using the path protocol, scoped to XNL features (no xnl not supported structures).
- Provide a dataloader that honors system metadata fields (proto/extend/export/remove) to resolve prototypes and overrides using XNL nodes and `.xnl` resources.
- Add tests and fixtures under `tests/resources` to validate the new protocols.

## Impact
- Affected specs: xnl-path, xnl-mutation, xnl-loader (new).
- Affected code: new `path/`, `mutation/`, `loader/` modules plus exports and fixtures in tests/resources.
