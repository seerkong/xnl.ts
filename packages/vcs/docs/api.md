# xnl-vcs API

## Core Concepts

- Object model: `blob`, `tree`, `commit`, `tag`.
- Object IDs are SHA-256 over canonical serialization.
- Repository refs: branches, tags, and `HEAD` (branch or detached).
- Merge modes: `already_up_to_date`, `fast_forward`, `merged`, `conflict`.

## Object Store

- `MemoryObjectStore.put(object) => objectId`
- `MemoryObjectStore.get(objectId) => object | null`
- `MemoryObjectStore.has(objectId) => boolean`
- `MemoryObjectStore.list() => objectId[]`

## Tree Conversion

- `buildTree(vfs, store) => treeId`
- `checkoutTree(treeId, vfs, store) => snapshot`
- `flattenTree(treeId, store) => FileSnapshot[]`

## Repository

- `init(defaultBranch = "main")`
- `commit(message, { author? }) => commitId`
- `checkout(ref, { force? })`
- `status() => { added, modified, deleted, entries, clean }`
- `createBranch(name, startPoint?)`
- `deleteBranch(name)`
- `listBranches()`
- `getBranchHead(name)`
- `createTag(name, target?, message?)`
- `listTags()`
- `listRefs()`
- `findMergeBase(refA, refB)`
- `log(limit?, startRef?)`
- `diff(refA, refB)`
- `merge(sourceRef, { resolutions? })`

## Revisioned Repository Adapter

Import the adapter from its explicit subpath:

```ts
import {
  RevisionedRepositoryAdapter,
  type RepositoryCheckpointReceipt,
  type RepositoryCheckpointResult,
  type RevisionedRepositoryAdapterOptions,
} from "xnl-vcs/revisioned-repository";
```

The subpath has the same runtime compatibility as `Repository`; it is not a
browser-safe entry.

### Public API

- `new RevisionedRepositoryAdapter({ repository, authority })` binds one
  `Repository` to one `RevisionedVfsAuthority`.
- `open()` reads the authority snapshot, loads a clone into the repository
  worktree, and returns the live revision with the snapshot.
- `apply(input)` delegates to the strict revisioned VFS mutation coordinator.
  Only an `applied` result replaces the repository worktree.
- `checkpoint(expectedLiveRevision, message, { author? })` checks the current
  live revision, commits the exact authority snapshot, verifies exact readback,
  and classifies durability.

`checkpoint()` returns a closed result:

- `checkpointed` includes a receipt with `liveRevision`, `commitId`, and
  durability.
- `conflict` means the supplied live revision was stale or belonged to another
  authority; commit did not start.
- `failed` is limited to `read` or `pre-commit`, where history is proven
  `not-started` and the public worktree is restored.
- `indeterminate` covers `commit`, `post-commit-verify`, `flush`, or `restore`
  failures. It reports observable `historyState`, `headBefore`, `observedHead`,
  optional `candidateCommitId`, and `worktreeState` without claiming an
  unproven rollback.

### Identity Boundary

Live revisions and VCS commit IDs are orthogonal. `liveRevision` is the opaque,
authority-qualified equality token for the persisted live snapshot;
`commitId` identifies a history object. They are distinct fields and must not
be substituted for one another. A VFS persistence receipt has no commit
identity; the checkpoint receipt is the first receipt that contains both.

A successful VFS apply is not rolled back by a later checkpoint failure. The
caller must retain the actual persisted live revision and handle the
checkpoint result independently.

### Exact Readback and Legacy Trees

Checkpoint commits use the lossless `xnl-vfs-v2` tree codec. Post-commit
verification performs a strict `xnl-vfs-v2` readback: the exact format marker
and payload are required, and the reconstructed snapshot must be structurally
equal to the complete authority AST.

That equality check is independent of diff alignment and is sensitive to
explicit `#id`. Diff uses element `#id` to align nodes and recognize moves
without treating `#id` as an ordinary update field; identity replacement is
delete plus add. Checkpoint verification does not infer equality from diff
output.

The general `readTreeSnapshot()`/`checkoutTree()` path remains backward
compatible: it decodes `xnl-vfs-v2` when present and falls back to the legacy
tree projection for unversioned trees. The strict checkpoint readback does not
fall back.

### Durability Boundary

`backend-flushed` is returned only when all of the following hold:

- the `Repository` has its own backend with a `flush()` capability;
- the active `repository.store` is the exact same object as
  `backend.objectStore`;
- the active `repository.contentStore` is the exact same object as
  `backend.contentStore`;
- that backend's `flush()` completes successfully.

Missing flush capability, absent backend, or any object/content store override
can only produce `memory-accepted`. If the correctly bound backend's `flush()`
throws after commit acceptance, the result is `indeterminate` in phase
`flush`, not a `memory-accepted` success.

### Revisioned Example

```ts
import { Repository } from "xnl-vcs";
import { RevisionedRepositoryAdapter } from "xnl-vcs/revisioned-repository";
import { MemoryRevisionedVfsAuthority } from "xnl-vfs/revisioned-persistence";

const repository = new Repository();
repository.init();

const authority = new MemoryRevisionedVfsAuthority(
  repository.vfs.getSnapshot(),
  { authorityId: "workspace:main" },
);
const adapter = new RevisionedRepositoryAdapter({ repository, authority });
const opened = await adapter.open();

const result = await adapter.checkpoint(
  opened.revision,
  "Checkpoint live workspace",
);

if (result.status === "checkpointed") {
  console.log(result.receipt.liveRevision, result.receipt.commitId);
}
```

## Merge Conflict Types

- `RENAME_RENAME`
- `DELETE_MODIFY`
- `BINARY_UNMERGEABLE`

`merge(..., { resolutions })` accepts conflict resolutions:

```ts
{ metadataId: string, choice: "ours" | "theirs" | "base" }
```

## Repository Example

```ts
import { Repository } from "xnl-vcs";

const repo = new Repository();
repo.init();

repo.vfs.mkdir("vfs:///src", { recursive: true });
repo.vfs.writeFile("vfs:///src/main.ts", "export const v = 1;", { fileType: "text" });

const base = repo.commit("base");
repo.createBranch("feature", base);

repo.vfs.writeFile("vfs:///src/main.ts", "export const v = 2;", { overwrite: true, fileType: "text" });
repo.commit("main update");

repo.checkout("feature");
repo.vfs.writeFile("vfs:///src/feature.ts", "export const feature = true;", { fileType: "text" });
repo.commit("feature update");

repo.checkout("main", { force: true });
const merged = repo.merge("feature");
```
