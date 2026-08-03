# Knowledge Context

## Source Notes

| Source | Summary | Relevance |
|--------|---------|-----------|
| `packages/core/src/mutation/index.ts` | identity-mode diff, move reconciliation and mutable apply | Primary implementation surface |
| `packages/core/src/path/index.ts` | canonical path resolution and identity selector behavior | Precondition and diagnostics |
| `packages/core/tests/mutation.test.ts` | existing mutation and metadata identity behavior | Compatibility baseline |
| `packages/core/tests/mutation-parity.test.ts` | move fixture without full apply assertion | Required test hardening |

## Codebase Knowledge

- XNL AST values are plain recursive objects/arrays plus Word and Comment nodes.
- `applySingle` already centralizes all mutation kinds.
- `reconcileMoves` pairs delete/add mutations by effective identity.
- `xnl-core` exports mutation APIs from the package root.

## Domain Knowledge

- Identity is used to correlate facts across snapshots; it is not ordinary
  mutable state.
- An authoring transaction needs both mutation correctness and a separate
  session/persistence revision gate.

## Terms

| Term | Meaning |
|------|---------|
| effective identity | Node `#id`, falling back to legacy `metadata.id` in identity mode |
| dry-run | Apply a batch to an isolated clone and return applied/rejected data |
| precondition | Expected observable value that must match before a mutation applies |
| parity | Applying diff(base, target) produces target AST |
