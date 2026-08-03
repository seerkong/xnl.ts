# Knowledge Context

## Source Notes

| Source | Summary | Relevance |
|--------|---------|-----------|
| `packages/core/src/mutation/index.ts` | Direct-ID guard and strict dry-run | Correction owner |
| `packages/core/tests/mutation-authoring-characterization.test.ts` | Existing identity/atomicity baseline | Test extension |
| `codument/behaviors/xnl-mutation-transaction.xml` | Promoted identity contract | Behavior to strengthen |

## Codebase Knowledge

- Strict dry-run applies ordered mutations to an isolated working clone.
- Effective identity reads node `#id` first and metadata id as compatibility
  fallback.
- Existing final validation checks duplicate/missing identity, not continuity.

## Domain Knowledge

- Identity continuity is a structural invariant, not ordinary payload equality.
- A relative identity skeleton detects in-place replacement and hidden movement
  without comparing mutable payload.

## Terms

| Term | Meaning |
|------|---------|
| identity skeleton | Mapping from relative structural paths to effective element identities |
| hidden replacement | Identity change carried inside a broader update value |

