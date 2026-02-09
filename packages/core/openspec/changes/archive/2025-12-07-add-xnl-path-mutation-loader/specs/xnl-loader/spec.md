## ADDED Requirements
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
Loader resolution MUST ignore xnl not supported constructs (sections, static properties) and fail with a descriptive error when a declared prototype cannot be found within the available `Prefabs` of the matching DSL type. Resolution MUST preserve original child/body ordering while replacing references.

#### Scenario: Missing prototype error
- **WHEN** a node declares `proto='MissingOne'` but no matching `Prefabs` entry exists for its tag
- **THEN** loading raises an error describing the missing prototype instead of silently returning the unresolved node.
