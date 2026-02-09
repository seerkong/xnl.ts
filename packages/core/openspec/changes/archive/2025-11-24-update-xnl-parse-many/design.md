## Context
The XNL namespace currently exposes `parseMulti`; the intended name is `parseMany` to match documentation expectations. This is a surface-level API rename without behavior changes.

## Goals / Non-Goals
- Goals: rename the namespaced multi-node parser to `parseMany`; keep behavior identical; align docs/specs/tests.
- Non-Goals: change parsing semantics or formatting behavior.

## Decisions
- Add `XNL.parseMany` that delegates to `parseXnl` and deprecate/remove `parseMulti`.
- Update package exports and README to reflect the new name.

## Risks / Trade-offs
- Minor breaking change for consumers using `parseMulti`; mitigated by quick rename and updated docs.
