# Track Spec: add-xnl-path-mutation-loader

## 概述

本归档由 OpenSpec archived change `add-xnl-path-mutation-loader` 转换而来，保留原始归档日期 2025-12-07。
以下能力规范增量按 capability 分组，并保持原 OpenSpec delta 内容。

## Capability: xnl-loader

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

## Capability: xnl-mutation

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

## Capability: xnl-path

## ADDED Requirements
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
