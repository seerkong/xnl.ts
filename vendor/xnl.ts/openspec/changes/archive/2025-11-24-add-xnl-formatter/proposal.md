# Change: Add XNL formatter and unified XNL API

## Why
Consumers need a JSON.stringify-like formatter for XNL plus a single XNL namespace wrapping the parse helpers for clarity and ease of use across front/back ends.

## What Changes
- Add `XNL.stringify` with single-line output by default and configurable pretty-printed formatting.
- Provide `XNL.parseMulti`, `XNL.parseSingle`, and `XNL.parseUnique` wrappers around existing parse helpers.
- Document formatting rules (attributes, bodies, raw/text preservation, indent behavior) and new API surface.

## Impact
- Affected specs: xnl-formatter (new), xnl-parser (modified for API wrappers)
- Affected code: formatter implementation, API facade, tests, docs/build export updates
