# xnl-path Specification

## Purpose
TBD - created by archiving change add-xnl-path-mutation-loader. Update Purpose after archive.
## Requirements
### Requirement: Parse XNL path strings
The system SHALL parse XNL path strings into structured path items supporting `UniqueName` (`#name`), `InstanceProperty` (`:property`), `MapKey` (`::'key'`), and `ListIndex` (`::0`) segments. Namespace and static-property segments are not supported and MUST raise an error.

#### Scenario: Parse metadata key
- **WHEN** parsing path `#root:metadata::'id'`
- **THEN** the parser returns items `[UniqueName('root'), InstanceProperty('metadata'), MapKey('id')]` and rejects unsupported separators.

### Requirement: Resolve XNL paths
The system SHALL resolve a parsed or raw path against an `XnlDocument` or `XnlNode`, returning the addressed node/value or throwing if a required segment is missing. `UniqueName` selects the first `ElementNode` whose `metadata.id` matches via depth-first search; `extend` traversal uses `extend.children` keyed by tag and respects `extend.order` when indices are used.

#### Scenario: Resolve extend child metadata
- **WHEN** resolving `#page:extend::'header':metadata::'title'` on a node whose `metadata.id` is `page` and whose `extend.children.header.metadata.title` is `"Hello"`
- **THEN** the resolver returns `"Hello"` and errors if `header` is absent.

### Requirement: Path-based updates
The path module SHALL provide setters that can write into map-like fields (`metadata`, `attributes`, plain objects, `extend.children`) and list-like fields (`body`, arrays, `extend.order`), creating intermediate containers when safe to do so and throwing on incompatible types.

#### Scenario: Insert body item
- **WHEN** setting path `#root:body::1` to a new element on a DataElement with two existing `body` entries
- **THEN** the setter inserts at index `1`, shifts later entries, and returns the updated root node.

