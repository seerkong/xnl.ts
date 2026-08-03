# xnl-vfs API

## Invariants

- All public paths use `vfs:///...`.
- Every `folder`/`file` node carries stable `metadata.id`.
- Path index maps canonical VFS path to `metadata.id` and back.
- File type dispatch is explicit: `xnl`, `text`, `binary`.
- XNL diff format is standard `XnlMutation[]` from `xnl-core`.

## Path Utilities

- `normalizeVfsPath(path)` normalizes separators and dot segments.
- `joinVfsPath(base, ...parts)` joins and normalizes.
- `dirnameVfsPath(path)` returns parent path.
- `basenameVfsPath(path)` returns last segment.
- `relativeVfsPath(from, to)` returns POSIX relative path.

## VirtualFileSystem

- `mkdir(path, { recursive? })`
- `writeFile(path, content, { fileType?, overwrite?, extend?, metadataId? })`
- `readFile(path)`
- `readdir(path)`
- `stat(path)`
- `exists(path)`
- `rename(from, to, { overwrite? })`
- `copy(from, to, { overwrite? })`
- `unlink(path)`
- `rmdir(path, { recursive? })`
- `getSnapshot()` / `loadSnapshot(snapshot)`
- `getPathIndex()`

## File Handlers

- `xnlFileHandler`
  - `diff(base, next) => XnlMutation[]`
  - `apply(base, diff) => string`
  - `merge(base, ours, theirs) => { merged }`
- `textFileHandler`
  - line-based diff and non-overlap 3-way merge
- `binaryFileHandler`
  - hash-based replacement and `BINARY_UNMERGEABLE` conflict

## Mutation Bridge

- `diffVfs(baseSnapshot, nextSnapshot) => XnlMutation[]`
- `applyVfsMutations(baseSnapshot, mutations) => nextSnapshot`
- `applyVfsMutationsAtomically(baseSnapshot, mutations)`

## Revisioned Persistence

Use the explicit browser-safe subpath for the revisioned persistence contract:

```ts
import {
  createIndexedDbRevisionedVfsAuthority,
  MemoryRevisionedVfsAuthority,
  applyRevisionedVfsMutations,
  areXnlSnapshotsStructurallyEqual,
  type RevisionedVfsAuthority,
  type RevisionedVfsReceipt,
  type RevisionedVfsSnapshot,
  type VfsRevision,
} from "xnl-vfs/revisioned-persistence";
```

This subpath exports the authority contract, in-memory and IndexedDB authority
implementations, complete-AST structural equality, and the strict
`XnlMutationBatch` coordinator. It does not expose the legacy `VfsMutation`
bridge. The browser-safe guarantee applies to this subpath, not to the
`xnl-vfs` package root.

### Public API

- `VfsRevision` is an authority-qualified opaque equality token. Compare both
  `authorityId` and `value`; do not parse, order, or replace it with a VCS
  commit ID.
- `RevisionedVfsAuthority.read()` returns the current revision and a snapshot.
- `RevisionedVfsAuthority.compareAndSwap({ expectedRevision, snapshot })`
  returns `applied`, `unchanged`, `conflict`, or `failed`.
- `MemoryRevisionedVfsAuthority(initialSnapshot, options)` is a deterministic
  reference implementation. Its successful receipts use
  `durability: "memory"`.
- `createIndexedDbRevisionedVfsAuthority(options)` seeds a browser workspace
  once and then reopens its durable snapshot and opaque revision. Freshness,
  no-op detection, and snapshot/revision replacement share one IndexedDB
  readwrite transaction; successful receipts use `durability: "workspace"`.
- `applyRevisionedVfsMutations(authority, input)` performs a clone-based strict
  dry run and then one authority CAS. It returns `applied`, `unchanged`,
  `conflict`, `rejected`, or `failed`.
- `areXnlSnapshotsStructurallyEqual(left, right)` compares complete AST
  structure.

`applyRevisionedVfsMutations` accepts `XnlMutationBatch` and mutation options
that deliberately omit `metadataIdMode`. The coordinator forces
`metadataIdMode: "identity"` at runtime. Direct mutation of an element's
effective identity is rejected; identity replacement must be represented as
old-node delete plus new-node add.

### Diff Alignment and Snapshot Equality

XNL diff and snapshot equality have different responsibilities:

- Diff uses an element `#id` to align corresponding nodes and to recognize
  moves. It does not emit an ordinary payload-field update for `#id`; changing
  identity is a delete plus an add. This does not mean diff ignores or does not
  compare `#id`: it reads `#id` as node identity.
- Structural equality recursively compares the complete AST and is sensitive
  to explicit `#id`, metadata fallback identity, and transitions between those
  identity sources. Object key insertion order is irrelevant; array, body, and
  Extend order and own optional-field presence remain significant.

Therefore, an empty ordinary-field diff is not proof of snapshot equality.
Persistence no-op detection must use
`areXnlSnapshotsStructurallyEqual`, not diff output.

### Revision and Receipt Boundary

A live VFS revision and a VCS commit ID are orthogonal identities. A
`RevisionedVfsReceipt` contains `previousRevision`, `revision`, `persistedAt`,
and VFS durability; it never contains commit identity. Only a repository
checkpoint receipt owns both `liveRevision` and `commitId`.

Freshness is checked before no-op classification. A current, structurally equal
candidate returns `unchanged`; the same candidate with a stale or foreign
revision returns `conflict`.

Two independently opened IndexedDB authorities with the same `authorityId` and
database share one CAS linearization point. If both submit from the same base,
exactly one may apply; the other observes a conflict. `initialSnapshot` only
seeds an absent authority record and never replaces an existing fact.

### Revisioned Example

```ts
import { parseXnl, type DataElementNode } from "xnl-core";
import {
  MemoryRevisionedVfsAuthority,
  applyRevisionedVfsMutations,
} from "xnl-vfs/revisioned-persistence";

const initial = parseXnl(
  `<workspace #workspace state="draft">`,
).nodes[0] as DataElementNode;
const authority = new MemoryRevisionedVfsAuthority(initial, {
  authorityId: "workspace:demo",
});
const base = await authority.read();

const result = await applyRevisionedVfsMutations(authority, {
  base,
  mutations: [
    {
      type: "OBJECT_UPDATE",
      path: ":metadata::'state'",
      valueAfter: "saved",
    },
  ],
});

if (result.status === "applied") {
  console.log(result.receipt.revision);
}
```

### Browser Workspace Example

```ts
import { parseXnl, type DataElementNode } from "xnl-core";
import { createIndexedDbRevisionedVfsAuthority } from "xnl-vfs/revisioned-persistence";

const seed = parseXnl(
  `<workspace #workspace state="draft">`,
).nodes[0] as DataElementNode;
const authority = await createIndexedDbRevisionedVfsAuthority({
  authorityId: "workspace:demo",
  initialSnapshot: seed,
  dbName: "my-product-workspace",
});

// A later page load with the same database and authority id restores the
// durable snapshot and revision instead of replacing them with `seed`.
const current = await authority.read();
```

## VirtualFileSystem Example

```ts
import { VirtualFileSystem, diffVfs, applyVfsMutations } from "xnl-vfs";

const a = new VirtualFileSystem();
a.mkdir("vfs:///src", { recursive: true });
a.writeFile("vfs:///src/a.ts", "export const a = 1;", { fileType: "text" });

const b = new VirtualFileSystem(a.getSnapshot());
b.rename("vfs:///src/a.ts", "vfs:///src/b.ts");

const mutations = diffVfs(a.getSnapshot(), b.getSnapshot());
const applied = applyVfsMutations(a.getSnapshot(), mutations);
```
