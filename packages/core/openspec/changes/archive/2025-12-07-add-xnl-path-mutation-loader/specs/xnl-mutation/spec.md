## ADDED Requirements
### Requirement: Apply XNL mutations
The system SHALL accept a list of `XnlMutation` entries (type enum: `TREE_ADD`, `TREE_DELETE`, `TREE_MOVE`, `TREE_UPDATE`, `OBJECT_ADD`, `OBJECT_DELETE`, `OBJECT_UPDATE`) and apply them sequentially to an `XnlNode`/`XnlDocument` using the path protocol. Tree mutations target `body` arrays or `extend` children (including order); object mutations target map-like fields such as `metadata`/`attributes` or plain objects. Unsupported path segments or mismatched container types MUST throw.

#### Scenario: Apply metadata update and body insert
- **WHEN** applying `[OBJECT_UPDATE path=#item:metadata::'status' valueAfter='done', TREE_ADD path=#item:body::0 valueAfter=<new node>]` to a `DataElementNode` tagged `item`
- **THEN** the element’s `metadata.status` becomes `"done"` and the new child is inserted at `body[0]` with later children shifted.

### Requirement: Diff XNL nodes to mutations
The system SHALL provide a diff function that, given two XNL roots of the same kind, produces a minimal ordered list of mutations transforming the old node into the new node. Map differences in `metadata`/`attributes` emit object add/update/delete mutations keyed by path; `body` array differences emit tree add/delete/update/move by index; `extend.children` differences emit tree add/delete/update/move keyed by child tag and maintain `extend.order` changes. Text changes produce `TREE_UPDATE` for the text field on the element path.

#### Scenario: Diff body addition
- **WHEN** diffing an old node with `body` `[<a>]` and a new node with `body` `[<a>, <b>]`
- **THEN** the diff outputs a single `TREE_ADD` mutation with path `#container:body::1` (assuming the parent has `metadata.id = 'container'`) and `valueAfter=<b>`.

### Requirement: Mutation validation
Mutation apply and diff MUST validate that root node kinds match, that `TREE_MOVE` includes both `pathBefore` and `path`, and that delete/update mutations carry the appropriate before/after payloads when provided. Missing or incompatible data MUST produce descriptive errors rather than silent no-ops.

#### Scenario: Reject mismatched kinds
- **WHEN** attempting to diff a `TextElementNode` against a `DataElementNode`
- **THEN** the diff function throws an error explaining that roots must share the same kind before computing mutations.
