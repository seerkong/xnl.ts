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

## Example

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
