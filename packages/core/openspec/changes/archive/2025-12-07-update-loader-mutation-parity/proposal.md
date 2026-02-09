# Change: Align loader and mutation with dslsuite parity

## Why
- Current loader/mutation behavior diverges from the dslsuite implementation and its test suite, causing missing prototype resolution, remove markers, and tree/object mutation fidelity.
- dslsuite is the reference behavior; XNL must match it for downstream parity and to make mutation/apply a reliable foundation for future features.

## What Changes
- Loader: support typed prefab sections (e.g., `DslBPrefabs`), scoped prefab lookup, and nested map/array removals via `<delta remove=true>` when merging prototypes.
- Mutation: add move detection (same-level and cross-level) based on `metadata.id`, include dslsuite-style mutation fields, and update diff/apply logic accordingly.
- Keep path syntax as-is (no namespace/static segments), but ensure mutation diff/apply leverages `metadata.id` for stable identity.

## Impact
- Affected specs: xnl-loader, xnl-mutation
- Affected code: loader prototype collection/merge, remove handling, mutation diff/apply (including types), related tests/fixtures
