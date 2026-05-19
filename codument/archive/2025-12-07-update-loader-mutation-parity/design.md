# Design: update-loader-mutation-parity

> Converted from archived OpenSpec design. Original archive date: 2025-12-07.

## Context
- dslsuite loader supports typed prefab sections (e.g., `DslBPrefabs`) scoped per node and nested, prototype references from map/array/body entries, and deletion via `@remove` shorthand (`( @remove: true )`). XNL currently only reads a generic `Prefabs` extend child and does not delete nested map/array entries.
- dslsuite mutation diff/apply detects moves (same-level/cross-level) using stable ids, emits rich metadata (`targetUniqueName`, `parentUniqueNameBefore/After`, `pathBefore`), and apply honors these; XNL mutation only adds/deletes/updates by position with no move semantics.
- Path syntax remains simpler in XNL (no namespace/static segments).

## Goals / Non-Goals
- Goals: loader parity for prefab lookup/merge semantics; remove marker support via XNL-friendly `<delta remove=true>` nodes; mutation parity with move detection and dslsuite-style fields; keep path grammar unchanged.
- Non-Goals: adding namespace/static path segments, changing XNL syntax beyond remove marker tag and proto name mapping.

## Decisions
- Remove marker encoding: use `<delta remove=true>` nodes in maps/arrays/body to signal deletion when merging prototypes.
- Typed/scoped prefabs: accept extend children named `<Tag>Prefabs` (e.g., `DslBPrefabs`), respecting nearest scope first and falling back to ancestors; still honor generic `Prefabs` for backward compatibility.
- Identity for moves: use `metadata.id` as stable identifier when diffing arrays/extend children; detect reorder vs add/delete and emit move mutations (`TREE_MOVE_SAME_LEVEL`, `TREE_MOVE_CROSS_LEVEL`) with `path` and `pathBefore`.
- Mutation fields: include `targetUniqueName`, `parentUniqueNameBefore`, `parentUniqueNameAfter`, and `pathBefore` in outputs to mirror dslsuite expectations; apply ignores extras beyond what it needs to locate/move.

## Risks / Trade-offs
- Move detection relies on `metadata.id`; nodes without ids cannot be moved reliably and will degrade to add/delete.
- Remove markers encoded as nodes may collide if user legitimately uses `<delta>` as data; acceptable given dslsuite parity requirement.

## Migration Plan
1) Update specs.
2) Implement loader changes (typed prefabs, remove markers, map/array deletions).
3) Implement mutation model/diff/apply changes with move detection and metadata fields.
4) Add tests ported from dslsuite fixtures.
5) Run build/tests.
