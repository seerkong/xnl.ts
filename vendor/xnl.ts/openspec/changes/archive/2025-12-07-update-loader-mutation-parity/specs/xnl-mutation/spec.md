## ADDED Requirements
### Requirement: Move-aware mutation diff/apply
The mutation module SHALL detect node moves (same-level reorder and cross-level relocation) using stable `metadata.id` to match elements. It MUST emit `TREE_MOVE_SAME_LEVEL` and `TREE_MOVE_CROSS_LEVEL` mutations with `path`, `pathBefore`, `targetUniqueName`, `parentUniqueNameBefore`, and `parentUniqueNameAfter` fields mirroring dslsuite. Apply logic SHALL execute moves by removing from `pathBefore` and inserting at `path`, preserving order; unknown ids degrade to add/delete.

#### Scenario: Cross-level move detected
- **WHEN** diffing an old tree where `node6` (id `node6`) is under `node3` and a new tree where `node6` moves under `node1` at `body[2]`
- **THEN** the diff outputs a `TREE_MOVE_CROSS_LEVEL` with `pathBefore="#node3:body::2"` and `path="#node1:body::2"` plus parent/target ids, and applyMutations moves the existing node accordingly without re-creating it.

#### Scenario: Same-level reorder detected
- **WHEN** siblings `node4` and `node5` swap order under the same parent
- **THEN** the diff emits a `TREE_MOVE_SAME_LEVEL` capturing the original and new indices for that parent instead of add/delete, and applyMutations reorders in place.

### Requirement: Mutation metadata preservation
Diff results SHALL populate optional fields `targetUniqueName`, `parentUniqueNameBefore`, and `parentUniqueNameAfter` from `metadata.id` of the affected nodes/parents when available. Apply logic SHALL ignore these for execution but carry them through untouched to keep parity with dslsuite outputs.

#### Scenario: Metadata fields populated
- **WHEN** generating a move for child `node4` under parent `node3`
- **THEN** the mutation includes `targetUniqueName='node4'`, `parentUniqueNameBefore='node3'`, `parentUniqueNameAfter='node3'` alongside the paths.
