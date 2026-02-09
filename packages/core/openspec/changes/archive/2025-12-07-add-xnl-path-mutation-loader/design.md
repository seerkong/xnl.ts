## Context
- The opensource dslsuite already implements path, mutation (apply/diff), and dataloader protocols. XNL has overlapping concepts but fewer constructs: `metadata` and `attributes` maps (parallel to `attr`/`conf`), `body` arrays, and `extend` unique children (`order` + `children` keyed by `tag`). There is no linked-chain node structure, `sections` map, or static properties.
- We must reuse the dslsuite semantics where they overlap and drop unsupported parts, keeping TypeScript implementations simple and focused on XNL.

## Goals / Non-Goals
- Goals: (1) Path parser/resolver for XNL nodes; (2) Mutation apply/diff built on that path model; (3) Dataloader that resolves prototypes via metadata fields (proto/extendType/export/remove) stored on `DataElementNode` and uses XNL-friendly prefab storage.
- Non-Goals: Support for fields (chain node core/sections/static properties), custom container types, or linked-list behaviors; advanced conflict detection from the Java implementation.

## Decisions
- Path item types: support `UniqueName (#name)` mapped to an element’s metadata `id` field (not the tag), `InstanceProperty (:prop)` for `metadata`, `attributes`, `body`, `extend`, `text`, `textMarker`, and `tag`, `MapKey (::'key')`, and `ListIndex (::0)`. Namespace/static-property items are not supported. Map/list traversal also works for plain JS objects/arrays encountered in metadata/attributes/body.
- Path resolution rules: paths are evaluated relative to a given `XnlDocument` or `XnlNode`. `UniqueName` performs a depth-first search and returns the first `ElementNode` whose `metadata.id` matches the requested name. `InstanceProperty` applies only to the current node; `extend` is navigated by `MapKey` (child tag) into `extend.children[tag]`, with `ListIndex` allowed on `extend.order`. Missing segments throw when using strict getters (for mutation/diff) and return `undefined` from safe accessors. Fail-fast semantics are preferred for apply/diff.
- Mutation representation: introduce a TS-friendly `XnlMutation` shape with `type` enum covering `TREE_ADD`, `TREE_DELETE`, `TREE_MOVE`, `TREE_UPDATE`, `OBJECT_ADD`, `OBJECT_DELETE`, `OBJECT_UPDATE` (tree targets body/extend arrays; object targets metadata/attributes/maps). Mutations carry `path`, optional `pathBefore`, `valueBefore`, `valueAfter`, and optional metadata. Apply processes sequentially without conflict detection beyond basic validation.
- Diffing strategy: require root node kinds to match; compare metadata/attributes maps by keys, `body` arrays by index order, and `extend.children` by tag (preserving `order`). Generate minimal adds/updates/deletes/moves for body/extend; map/object updates for metadata/attributes. Text changes emit `TREE_UPDATE` on the element path with new text payload.
- Dataloader system fields: reuse field names on `metadata` (`proto`, `extendType`, `export`, `remove`). Prefabs are stored under an `extend` child named `Prefabs` whose `body` array holds prototype `DataElementNode`s. Prototype lookup uses the DSL type = element `tag` and prototype name from metadata `name` or `id`. `proto` references resolve against prefabs of the same DSL type, merging via `extendType` (only `Override` supported) with `remove` flags dropping fields/children. `export` marks resolved nodes to return in a grouped export map keyed by DSL type then name.
- Cleaning system fields: after resolution, strip proto/extend/remove/export control metadata from materialized nodes to avoid leaking loader internals.

## Risks / Trade-offs
- Diff granularity may miss semantic moves inside `metadata`/`attributes` (treated as map updates only) and ignores conflict detection, trading precision for simplicity.
- Prefab storage in a single extend child (`Prefabs`) assumes DSL authors follow the convention; cross-file/include mechanics are deferred.

## Open Questions
- Should path resolution stop at the first matching `tag` or allow scoping to siblings only (e.g., body vs extend)? Current plan is first match depth-first unless adjusted during review.
- Do we need to expose non-throwing apply behavior (skip missing) or always fail fast? Proposal leans to strict failures.
