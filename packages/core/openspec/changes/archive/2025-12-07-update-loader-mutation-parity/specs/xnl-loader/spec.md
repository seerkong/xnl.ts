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
