## Context
- Users need clearer syntax error feedback (e.g., which tag wasn't closed, where mismatches occur).
- Current parser exposes generic codes/messages with position info but without offending tag names or concise context strings.

## Goals / Non-Goals
- Goals: define how to include offending tag/token context and source location in error messages; cover common syntax issues (unclosed/mismatched tags or markers, invalid mixed blocks).
- Non-Goals: change warning semantics, introduce recovery or auto-fix, or alter success parsing logic.

## Decisions (draft)
- Report errors with tag/marker names and the expected vs found delimiter when applicable.
- Preserve position/line/column in `XnlParseError`, adding context strings for display and tests.
- Keep minimal performance impact; no streaming re-architecture.

## Open Questions
- Should messages include a short excerpt/snippet around the position? (assume yes if low-effort)
- Should extend/mixed-content errors list the parent tag name? (assume yes)
