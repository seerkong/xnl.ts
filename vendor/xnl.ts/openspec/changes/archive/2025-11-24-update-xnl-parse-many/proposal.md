# Change: Rename parseMulti to parseMany and update API/docs

## Why
The namespaced parse helper should expose `parseMany` (not `parseMulti`) to align with intended API and documentation, avoiding confusion for consumers.

## What Changes
- Rename the namespaced multi-node parse helper to `XNL.parseMany` across code, exports, and tests.
- Update README and any examples to use `XNL.parseMany`.
- Align specs to reflect the corrected API name.

## Impact
- Affected specs: xnl-parser (API name), xnl-formatter (API references)
- Affected code: XNL namespace exports, tests, README/documentation
