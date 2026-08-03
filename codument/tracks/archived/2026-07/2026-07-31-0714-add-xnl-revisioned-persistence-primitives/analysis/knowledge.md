# Knowledge Context

## Source Notes

| Source | Summary | Relevance |
|--------|---------|-----------|
| `packages/vfs/src/mutation-bridge.ts` | Clone-based atomic candidate apply | Candidate construction |
| `packages/vfs/src/*-persistence.ts` | Snapshot persistence without revision receipt | Persistence gap |
| `packages/vcs/src/repository.ts` | Worktree plus explicit commit history | Checkpoint boundary |
| `packages/vcs/src/repository-backend.ts` | Backend workspace/ref persistence ports | Adapter context |
| `packages/vcs/src/tree-converter.ts` | Legacy file-history projection that omits explicit element `#id` and merges business fields | Exact-checkpoint gap |
| Mission XNL-T2 | Requires CAS, flush receipt and live revision separation | Desired state |

## Codebase Knowledge

- XNL VFS uses `DataElementNode` snapshots as the complete worktree authority.
- VFS domain mutations and XNL mutations already have separate apply paths.
- Repository has no staging-area distinction; the complete worktree is committed.
- Existing IndexedDB persistence uses transactions internally, but no public CAS
  contract exists.
- `diffNodes` reads `#id` as alignment/move identity instead of emitting an
  ordinary payload update for it, so its mutation output is not a
  complete-AST equality predicate.
- Existing VCS tree objects are readable history projections, not lossless XNL
  AST snapshots.

## Domain Knowledge

- A live revision is a concurrency token owned by the current persistence
  authority, not necessarily a content hash or history object.
- Compare-and-swap must be a single authority operation to prevent time-of-check
  to time-of-use races.
- Persistence and history checkpointing can be sequenced without becoming one
  transaction.
- Snapshot equality, mutation diff, and VCS tree encoding are three distinct
  processors with different information-preservation requirements.

## Terms

| Term | Meaning |
|------|---------|
| live revision | Opaque equality token for the persisted editable snapshot |
| CAS | Atomic expected-revision check plus complete snapshot replacement |
| flush receipt | Evidence that a specific authority accepted and persisted a new live revision |
| checkpoint receipt | Evidence that a specific live revision was captured as a VCS commit |
| structural snapshot equality | Recursive comparison of every AST field, including identity authorities; object key order is ignored while arrays and Extend order are preserved |
| lossless tree v2 | Versioned VCS tree encoding used by exact checkpoint while legacy tree objects remain readable |
