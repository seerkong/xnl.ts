## 1. Implementation
- [x] 1.1 Update xnl-parser spec/EBNF and formatter spec to document slash-prefixed text closers.
- [x] 1.2 Change parser text-body parsing to require `</#marker?>`, including error messages/dedent markers.
- [x] 1.3 Update formatter emission and any helpers to output `</#marker?>` and adjust related tests/fixtures.
- [x] 1.4 Refresh parser/formatter unit tests for the new closer syntax and add/adjust coverage for mismatched markers.

## 2. Validation
- [x] 2.1 Run `npm run build`.
- [x] 2.2 Run `npm test`.
