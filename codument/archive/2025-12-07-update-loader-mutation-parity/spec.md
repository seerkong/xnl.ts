# Track Spec: update-loader-mutation-parity

## 概述

本归档由 OpenSpec archived change `update-loader-mutation-parity` 转换而来，保留原始归档日期 2025-12-07。
以下能力规范增量按 capability 分组，并保持原 OpenSpec delta 内容。

## Capability: xnl-loader

## ADDED Requirements
### Requirement: Typed prefab lookup and scoped resolution
The loader SHALL discover prototypes from typed prefab sections named `<Tag>Prefabs` (e.g., `DslBPrefabs`, `DslCPrefabs`) in addition to a generic `Prefabs` child. Prefabs are resolved with nearest-scope precedence: child prefab blocks shadow outer ones. Prototype references in metadata (`proto`) MUST resolve whether they appear on body children or nested values (map/array/object) and throw if missing.

#### Scenario: Resolve typed prefab in nearest scope
- **WHEN** a node references `proto="DslB_1"` and the closest `DslBPrefabs` child contains an exported `DslB_1`
- **THEN** the loader merges against that prefab and does not consult outer prefab scopes of the same type.

### Requirement: Remove markers in prototype merge
During prototype merge, a node `<delta remove=true>` inside maps or arrays SHALL delete the corresponding entry from the base prototype (map key removal, array element removal) before applying overrides. Control metadata (`proto`, `extendType`, `remove`, `export`, `name`, `id`, `schemaVersion`) SHALL be stripped from resolved output nodes.

#### Scenario: Remove nested map key
- **WHEN** a prototype map has `nested: { field2: "old" }` and the override contains `<delta remove=true>` at `nested.field2`
- **THEN** the resolved map omits `field2`.

#### Scenario: Remove array element
- **WHEN** a prototype array `[1, 2, 3]` is overridden with `<delta remove=true>` at index `1`
- **THEN** the resolved array becomes `[1, 3]`.

### Requirement: Prototype merge for inline value nodes
If a map/array entry is a `DataElementNode` whose metadata includes `proto`, the loader SHALL resolve it using the same typed prefab lookup and apply merge/remove semantics recursively, not only for top-level body children.

#### Scenario: Inline proto in map value
- **WHEN** a map value `<DslB proto="DslB_1">` appears under `fieldB.key1`
- **THEN** the loader resolves `<DslB_1>` from `DslBPrefabs`, applies overrides/removals, and stores the resolved element in the map value.

## Capability: xnl-mutation

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
