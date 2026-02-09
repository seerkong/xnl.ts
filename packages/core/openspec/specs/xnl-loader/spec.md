# xnl-loader Specification

## Purpose
TBD - created by archiving change add-xnl-path-mutation-loader. Update Purpose after archive.
## Requirements
### Requirement: Resolve proto metadata
The system SHALL load a `DataElementNode` DSL by honoring system metadata fields: `proto` (prototype name), `extendType` (only `Override` supported), and `remove` (marks a field/child for deletion during override). Prototypes are discovered under an `extend` child named `Prefabs` whose `body` array holds prototype `DataElementNode`s keyed by their metadata `name`/`id`. Resolving a node with `proto` MUST merge the referenced prototype and the node, honoring `remove` markers and stripping control metadata (`proto`, `extendType`, `remove`) from the resolved result.

#### Scenario: Override prototype attribute
- **WHEN** a node tagged `Widget` has metadata `proto='Base'` and metadata `title='Custom'`, and the `Prefabs` child contains a `Widget` prototype named `Base` with metadata `title='Default'`
- **THEN** loading resolves the node to a `Widget` whose metadata `title` is `"Custom"` and no control fields remain.

### Requirement: Export resolved DSLs
The loader SHALL support batch transformation that walks lists of XNL nodes, resolves prototypes, and returns both resolved roots and an export map keyed by DSL type (`tag`) then export name. A resolved node is exported when its metadata includes `export=true` and it has a metadata `name`/`id`; exports found inside prefab sections are included as well.

#### Scenario: Collect exports
- **WHEN** batch loading two documents containing `Widget` nodes marked `export=true` with names `Card` and `Button`
- **THEN** the export map includes `Widget.Card` and `Widget.Button` entries pointing to resolved nodes.

### Requirement: Loader robustness
Loader resolution MUST ignore dslsuite-only constructs (sections, static properties) and fail with a descriptive error when a declared prototype cannot be found within the available `Prefabs` of the matching DSL type. Resolution MUST preserve original child/body ordering while replacing references.

#### Scenario: Missing prototype error
- **WHEN** a node declares `proto='MissingOne'` but no matching `Prefabs` entry exists for its tag
- **THEN** loading raises an error describing the missing prototype instead of silently returning the unresolved node.

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

