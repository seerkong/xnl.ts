## 1. Implementation
- [x] 1.1 Update xnl-loader spec to cover typed/scoped prefabs and remove markers; update xnl-mutation spec for move detection/fields.
- [x] 1.2 Implement loader prefab lookup/merge with `<delta remove=true>` handling for map/array entries and scoped typed prefabs.
- [x] 1.3 Extend mutation model/diff/apply to emit/handle move mutations using `metadata.id`, including dslsuite-style metadata fields.
- [x] 1.4 Add/align tests and fixtures mirroring dslsuite loader/mutation cases.

## 2. Validation
- [x] 2.1 Run `npm run build`.
- [ ] 2.2 Run `npm test`. (fails in this environment: `crypto.getRandomValues is not a function`)
