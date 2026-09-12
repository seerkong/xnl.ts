# Track: escape-colliding-text-markers-in-xnl-vfs-snapshots

## Problem

`serializeVfsSnapshot` currently writes every content payload with `textMarker: ""`. If an XNL file stored in the VFS contains its own `</?>` terminator, the outer full snapshot closes early and `deserializeVfsSnapshotFromString` cannot parse the serializer's output.

## Change

- deterministically choose a collision-free XNL text marker for every serialized content payload;
- preserve exact payload bytes and deterministic snapshot output;
- add nested XNL and adversarial marker collision round-trip tests;
- keep manifest mode and existing public APIs compatible.

## Non-goal

Do not base64-wrap ordinary XNL/text files or change their VFS file type to evade the grammar collision.
