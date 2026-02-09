# Change: improve parser error messaging

## Why
- Current parser errors lack actionable detail for end users; unclear which tag or position failed.
- Users want explicit messages pointing to the problem location (e.g., which tag was not closed).

## What Changes
- Enhance XNL parser to surface descriptive syntax errors with location and offending tag/token context.
- Update specs, docs, and tests to cover detailed error messaging for common failures (unclosed tags, mismatched markers, invalid blocks).

## Impact
- Affected specs: xnl-parser
- Affected code: parser error handling, documentation, tests
