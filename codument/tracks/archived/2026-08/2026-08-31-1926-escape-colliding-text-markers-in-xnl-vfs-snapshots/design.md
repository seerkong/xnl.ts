# Design: escape-colliding-text-markers-in-xnl-vfs-snapshots

`TextElement.textMarker` is part of XNL's native quoting protocol. Snapshot serialization keeps the empty marker when it is safe; otherwise it scans the stable `VFS`, `VFS1`, `VFS2`, ... candidate sequence until the candidate terminator is absent from the payload. Nested XNL therefore receives a non-empty marker without content rewriting.

The selection algorithm is pure, bounded by payload contents, and independent of process state, so repeated serialization is byte-identical. Deserialization already preserves arbitrary text markers and reads `text` unchanged; no format-version bump is required because marked TextElements are valid in snapshot v2.
