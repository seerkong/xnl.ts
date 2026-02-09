## 1. Path protocol
- [x] 1.1 Implement XNL path parser/resolver covering metadata/attributes/body/extend nodes.
- [x] 1.2 Add unit tests for path parsing/resolution (maps, arrays, extend children, missing paths).

## 2. Mutation protocol
- [x] 2.1 Define mutation data shapes (types/enums) scoped to XNL nodes and supported path item types.
- [x] 2.2 Implement mutation apply helpers for object/array/extend/text/body updates using the path protocol.
- [x] 2.3 Implement diffing for two XNL roots (same kind) to produce mutation lists; cover adds/updates/deletes/moves relevant to XNL structures.
- [x] 2.4 Add mutation protocol tests using `.xnl` fixtures for apply and diff.

## 3. Dataloader protocol
- [x] 3.1 Implement prototype resolution using metadata system fields (proto/extendType/export/remove) on `DataElementNode` with Prefabs-style storage.
- [x] 3.2 Support batch transform/export map APIs and ensure system metadata is cleaned after resolution.
- [x] 3.3 Add dataloader tests with `.xnl` fixtures covering proto overrides, removals, and exports.

## 4. Wiring and validation
- [x] 4.1 Expose new path/mutation/loader entry points from the public API and document brief usage.
- [x] 4.2 Add required fixtures under `tests/resources`.
- [x] 4.3 Run `npm run build` and `npm run test` to validate.
