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

## Merge Conflict Types

- `RENAME_RENAME`
- `DELETE_MODIFY`
- `BINARY_UNMERGEABLE`

`merge(..., { resolutions })` accepts conflict resolutions:

```ts
{ metadataId: string, choice: "ours" | "theirs" | "base" }
```

## Example

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
