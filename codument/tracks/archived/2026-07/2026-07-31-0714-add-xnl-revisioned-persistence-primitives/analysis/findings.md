# Findings

## Found Facts

- `xnl-vfs.applyVfsMutationsAtomically` clones the base and returns a candidate,
  but it has no persistence revision or receipt.
- `LocalFsVfsPersistence.saveSnapshot` and
  `IndexedDbVfsPersistence.saveSnapshot` return `void`/`Promise<void>` and accept
  no expected revision.
- `Repository.commit` returns a content-addressed commit id and moves the
  branch, but this identity is not a live workspace CAS token.
- `RepositoryBackend.updateBranchHead` receives `oldCommitId`, while existing
  backends do not use it as a complete authoring workspace revision protocol.
- IndexedDB repository backends expose `flush()`, but flush only drains queued
  writes and does not produce a revisioned receipt.

## Constraints

- Live revision, VCS commit id and collaboration version id must remain distinct.
- The persistence authority, not the coordinator, must own atomic CAS.
- Failed or stale persistence cannot advance either snapshot or revision.
- Existing package APIs remain compatible.
- Only the new `xnl-vfs/revisioned-persistence` subpath gains a browser-safe
  guarantee; existing package roots retain their current Node-dependent
  compatibility boundary.

## Open Questions

- Concrete filesystem/database authorities beyond the memory reference adapter
  belong to later owner-specific tracks.

## Conclusions

- Add a new generic revisioned authority contract in `xnl-vfs`.
- Reuse existing mutation engines to construct candidates.
- Add a thin `xnl-vcs` repository adapter whose checkpoint is explicit and
  revision-checked.

## Fresh AttractorCheck

- Existing package roots already contain Node-only imports, so the new browser
  guarantee is scoped to `xnl-vfs/revisioned-persistence`.
- Revision must include authority identity; opaque value alone is insufficient.
- Semantic no-op must still pass through authority CAS so stale no-op conflicts.
- The memory authority must serialize concurrent CAS operations.
- Strict authoring must reject direct `#id` mutation before authority write.
- Checkpoint must commit the exact authority snapshot, not an independently
  mutable repository worktree.
- Backend failure after commit acceptance is indeterminate unless an awaitable
  flush confirms durability.

## Fresh AttractorCheck 2

- The checkpoint contract needs a closed result union, not only a receipt plus
  prose about failure.
- `failed` is reserved for read/pre-commit failures where no commit acceptance
  occurred; commit, post-commit verification, and flush failures are
  `indeterminate` with observed head evidence.
- An absent flush port can only prove `memory-accepted`; `backend-flushed`
  requires a successful awaitable flush.
- The persistence Track depends on the corrective strict identity Track so a
  whole-node/container update cannot bypass `#id` identity continuity before
  authority CAS.

## Fresh AttractorCheck 3

- The corrective strict identity Track is an activation gate, not just prose:
  persistence implementation starts only after its archive/behavior/test
  evidence is present.
- Repository currently commits its public VFS and may advance memory head
  before backend failure. An exact-snapshot commit primitive must stage in a
  try/finally and restore the public worktree independently from truthful
  history outcome classification.
- Checkpoint failure results report both observed head evidence and whether the
  public worktree was restored.
- New subpaths require package exports plus tsup entries. Browser safety is
  verified on the built ESM/CJS transitive import graph.

## Fresh AttractorCheck 4

- The corrective identity Track is archived and its promoted behavior confirms
  that `#id` aligns nodes and detects moves rather than acting as ordinary
  update payload.
- That correct diff behavior means bidirectional `diffNodes` emptiness is not a
  valid persistence equality test: changing only a root or descendant explicit
  `#id` can produce no diff.
- Persistence no-op and checkpoint read-back therefore require a separate
  identity-sensitive structural comparator over every AST field.
- The existing VCS tree projection loses element explicit `#id` and merges
  metadata with attributes, so it cannot represent an exact authority snapshot.
- Exact checkpoint needs a versioned lossless tree encoding plus legacy object
  read fallback; the current legacy `Repository.commit` path remains compatible.
- Checkpoint restore failure is independent from commit acceptance. The closed
  result must include `phase=restore`, `historyState`, and `worktreeState`.
- Durability can only be upgraded to `backend-flushed` by the backend bound to
  the same Repository instance; an arbitrary injected flush function is not
  evidence.
- The browser-safe coordinator is deliberately limited to
  `XnlMutationBatch + XnlMutationBatchOptions -> dryRunMutations`. Legacy
  `VfsMutation` conversion remains outside this Track.

## Fresh AttractorCheck 5

- Versioned tree fields must also survive `captureRepositorySnapshot`,
  node/string serialization, deserialization, and
  `restoreRepositoryFromSnapshot`; otherwise restore recomputes a different
  object under the original content id.
- V2 therefore stores the complete lossless AST payload on the root tree while
  retaining legacy entries as an index projection. This avoids reconstructing
  arbitrary TextElement, Comment, Word, primitive, nested object/array, and
  optional-field presence from file-oriented entries.
- A backend flush is insufficient when Repository active object/content stores
  were overridden. `backend-flushed` requires reference-equality binding to the
  backend-owned stores plus successful flush of that backend.
- Once checkpoint head observation begins, `headBefore` and `observedHead` are
  mandatory `ObjectId | null`; `null` means an observed unborn branch, not
  missing evidence.

## Fresh AttractorCheck 6

- Exposing the complete `XnlMutationBatchOptions` would let callers select
  `metadataIdMode="metadata"` and disable the guard for a VFS node whose
  `metadata.id` is its effective identity.
- The coordinator surface therefore omits `metadataIdMode`, and the runtime
  always applies `metadataIdMode="identity"` after spreading caller options.
- Direct add/update/delete of effective fallback `metadata.id` is a rejected
  pre-authority operation; compile-time omission alone is not considered a
  sufficient guard.

## Activation Gate

- A final fresh coding AttractorCheck returned `APPROVED`.
- Strict Codument validation passed.
- The archived strict-identity prerequisite and its 159 characterization tests
  were independently resolved before activation.

## P0-T1 Strict Identity Prerequisite Verification

- Verification timestamp: `2026-07-30T21:37:22Z`.
- Archive completion command:
  `xmllint --xpath 'concat(string(/*[local-name()="Track"]/*[local-name()="Metadata"]/*[local-name()="Status"]), "|nonDoneNodes=", count(//*[local-name()="Task" or local-name()="TaskGroup"][@status != "DONE"]), "|uncheckedCriteria=", count(//*[local-name()="Criterion"][@checked != "true"]))' codument/tracks/archived/2026-07/2026-07-30-2245-reject-xnl-identity-replacement-bypass/track.xml`.
  Result: exit `0`,
  `completed|nonDoneNodes=0|uncheckedCriteria=0`.
- Behavior promotion command:
  `diff -u <(xmllint --noblanks --xpath '/*[local-name()="behavior-patch"]/*[local-name()="upsert"]/*[local-name()="requirement"][@id="identity-key-semantics"]' codument/tracks/archived/2026-07/2026-07-30-2245-reject-xnl-identity-replacement-bypass/behavior_deltas/xnl-mutation-transaction/delta.xml) <(xmllint --noblanks --xpath '/*[local-name()="behaviors"]/*[local-name()="requirement"][@id="identity-key-semantics"]' codument/behaviors/xnl-mutation-transaction.xml)`.
  Result: exit `0` with no diff; the archived requirement is present unchanged
  in the promoted behavior registry.
- Promoted behavior evidence command:
  `xmllint --xpath 'concat(normalize-space(/*[local-name()="behaviors"]/*[local-name()="requirement"][@id="identity-key-semantics"]/*[local-name()="suite"]/*[local-name()="case"][@id="detect-move-by-id"]/*[local-name()="then"]), " || ", normalize-space(/*[local-name()="behaviors"]/*[local-name()="requirement"][@id="identity-key-semantics"]/*[local-name()="suite"]/*[local-name()="case"][@id="reject-hidden-id-replacement"]/*[local-name()="then"]))' codument/behaviors/xnl-mutation-transaction.xml`.
  Result: exit `0`; the promoted cases require `#id` to identify structural
  moves rather than changed payload and require hidden replacement to return
  `IDENTITY_MUTATION_FORBIDDEN` with only an unchanged base clone exposed.
- Characterization command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`.
  Result: exit `0`; `1` file and `159/159` tests passed.
- Mutation parity command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-parity.test.ts`.
  Result: exit `0`; `1` file and `2/2` tests passed.
- Core regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test`.
  Result: exit `0`; `14/14` files and `226/226` tests passed.
- State verification command:
  `xmllint --xpath 'concat("task=", string(//*[local-name()="Task"][@id="P0-T1"]/@status), "|checked=", count(//*[local-name()="Task"][@id="P0-T1"]//*[local-name()="Criterion"][@checked="true"]), "|unchecked=", count(//*[local-name()="Task"][@id="P0-T1"]//*[local-name()="Criterion"][@checked!="true"]), "|phase=", string(//*[local-name()="TaskGroup"][@id="P0"]/@status))' codument/tracks/active/add-xnl-revisioned-persistence-primitives/track.xml`.
  Result: exit `0`, `task=DONE|checked=3|unchecked=0|phase=ACTIVE`.
- Track structure command:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`,
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- Scope check: this leaf task changed no production code. The evidence satisfies
  `P0-T1-AC1` through `P0-T1-AC3`; phase `P0` remains `ACTIVE` for the parent
  phase hook.

## P0 Phase Gate

- Parent reran the 159-test mutation authoring characterization successfully.
- A fresh phase-after coding AttractorCheck returned `PASS`.
- P0 is closed; P1 may define failing characterization and public contracts.

## P1-T1 Revisioned Persistence Characterization

- Verification timestamp: `2026-07-30T21:52:12Z`.
- Added executable, non-skipped characterization in
  `packages/vfs/tests/revisioned-persistence.test.ts` and
  `packages/vcs/tests/revisioned-repository.test.ts`; no production source was
  changed.
- The VFS fixture scope contains 17 cases:
  - all five coordinator outcomes (`applied`, `unchanged`, `conflict`,
    `rejected`, `failed`) with caller-base and persisted-state observations;
  - failed-flush retry, stale semantic no-op, same-base concurrent double-write,
    and same-valued cross-authority token conflict;
  - identity-sensitive non-noop checks for explicit `#id`, effective
    `metadata.id`, and a same-value explicit-to-fallback authority transition;
  - direct add/update/delete matrices for both `#id` and effective fallback
    `metadata.id`, including a runtime `metadataIdMode="metadata"` escape
    attempt, with zero authority writer calls required on rejection.
- The VCS fixture scope contains 3 cases:
  - a checkpoint receipt keeps `liveRevision` and `commitId` distinct while
    checkpointing remains separate from live revision advancement;
  - stale checkpoint returns conflict without creating branch history;
  - an injected backend error after in-memory branch acceptance must be
    `indeterminate`, must not claim `historyState="not-started"`, and must
    expose observed head plus restored worktree evidence.
- Type-check commands:
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs lint`
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`
  Both exited `0` with `tsc --noEmit`, proving the characterization parses and
  type-checks.
- Focused expected-RED commands:
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence.test.ts`
    exited `1`; Vitest collected all 17 tests and all 17 failed with
    `Expected xnl-vfs to export MemoryRevisionedVfsAuthority and applyRevisionedVfsMutations`.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test revisioned-repository.test.ts`
    exited `1`; Vitest collected all 3 tests and all 3 failed with
    `Expected xnl-vcs to export RevisionedRepositoryAdapter with explicit checkpoint support`.
  These failures are the intended RED baseline for absent production
  contracts/implementations, not syntax, transform, module-loading, or
  environment failures.
- Neighboring environment baselines:
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test mutation-bridge.test.ts`
    exited `0` with `2/2` tests passed.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-core.test.ts`
    exited `0` with `2/2` tests passed.
- Track structure command:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`,
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- State verification command:
  `xmllint --xpath 'concat("task=", string(//*[local-name()="Task"][@id="P1-T1"]/@status), "|checked=", count(//*[local-name()="Task"][@id="P1-T1"]//*[local-name()="Criterion"][@checked="true"]), "|unchecked=", count(//*[local-name()="Task"][@id="P1-T1"]//*[local-name()="Criterion"][@checked!="true"]), "|phase=", string(//*[local-name()="TaskGroup"][@id="P1"]/@status))' codument/tracks/active/add-xnl-revisioned-persistence-primitives/track.xml`.
  Result: exit `0`, `task=DONE|checked=4|unchecked=0|phase=ACTIVE`.
- Scope check: this leaf task added only the two test files and updated its
  Codument evidence/status. It implemented no revisioned production API and
  satisfies `P1-T1-AC1` through `P1-T1-AC4`; phase `P1` remains `ACTIVE`.

## P1-T2 Revision Contracts And Snapshot Equality

- Verification timestamp: `2026-07-30T22:05:14Z`.
- Added `packages/vfs/src/revisioned-persistence.ts` with reusable public
  contracts for `Awaitable`, authority-qualified `VfsRevision`,
  revisioned snapshots, CAS input and closed outcome, live flush receipt,
  persistence diagnostics, the authority port, and the coordinator input and
  closed outcome.
- `RevisionedVfsReceipt` contains only live persistence evidence and no
  `commitId`; the public coordinator options are exactly
  `Omit<XnlMutationBatchOptions, "metadataIdMode">`. Contract documentation
  assigns authority scope, freshness, semantic no-op, and conflict/failure
  no-advance responsibility to the authority CAS linearization point.
- Added and exported `areXnlSnapshotsStructurallyEqual`. It recursively
  compares all own enumerable AST fields and optional-field presence, ignores
  object key insertion order, and preserves array/body/Extend order. It does
  not call `diffNodes` or serialize through `JSON.stringify`.
- Comparator coverage exercises DataElement/TextElement kind and tag,
  explicit `#id` Word namespace/name, metadata, attributes, text,
  textMarker, Comment, Word, primitives, nested object/array values, body,
  Extend children/order, optional presence, root/descendant explicit identity,
  metadata fallback identity, and same-value explicit-to-fallback authority
  transition. Compile-time assertions lock the closed result status sets,
  authority-qualified revision shape, receipt separation, and coordinator
  option omission.
- TDD RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-equality.test.ts`.
  Before the source export existed, Vitest collected all `18` tests and all
  `18` failed only with
  `areXnlSnapshotsStructurallyEqual is not a function`.
- Focused GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-equality.test.ts`.
  Result: exit `0`; `1` file and `18/18` tests passed.
- VFS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs lint`.
  Result: exit `0` with `tsc --noEmit`.
- P1-T1 expected-RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence.test.ts`.
  Result: exit `1`; Vitest collected all `17` tests and all `17` failed only
  with the existing P2 boundary:
  `Expected xnl-vfs to export MemoryRevisionedVfsAuthority and applyRevisionedVfsMutations`.
  This is not a P1-T2 regression; neither runtime API is implemented in this
  leaf task.
- Scope check: the only runtime export added by this leaf task is the
  comparator. No `MemoryRevisionedVfsAuthority`,
  `applyRevisionedVfsMutations`, VCS checkpoint API, package export map, or
  build entry was implemented. `P1-T2-AC1` through `P1-T2-AC4` are satisfied;
  phase `P1` remains `ACTIVE` for its parent phase hook.
- Track structure command:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`,
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- State verification command:
  `xmllint --xpath 'concat("task=", string(//*[local-name()="Task"][@id="P1-T2"]/@status), "|checked=", count(//*[local-name()="Task"][@id="P1-T2"]//*[local-name()="Criterion"][@checked="true"]), "|unchecked=", count(//*[local-name()="Task"][@id="P1-T2"]//*[local-name()="Criterion"][@checked!="true"]), "|phase=", string(//*[local-name()="TaskGroup"][@id="P1"]/@status))' codument/tracks/active/add-xnl-revisioned-persistence-primitives/track.xml`.
  Result: exit `0`, `task=DONE|checked=4|unchecked=0|phase=ACTIVE`.

## P1 Phase Gate

- Parent reran the 18-test comparator suite and VFS typecheck successfully.
- A fresh phase-after coding AttractorCheck returned `PASS`.
- P1 is closed with P2/P5 characterization intentionally red only at their
  missing runtime exports.

## P2-T1 Memory Revisioned VFS Authority

- Verification timestamp: `2026-07-30T22:25:08Z`.
- Added `MemoryRevisionedVfsAuthority` and its public options to
  `packages/vfs/src/revisioned-persistence.ts`. The authority clones its
  initial snapshot, clones CAS submissions before queueing, clones every read,
  and returns detached revision/receipt values.
- The default authority token is `revision:0`; injected `revisionFactory` and
  `clock` control deterministic revision and timestamp generation. Successful
  replacement advances the sequence exactly once and reports
  `durability="memory"`.
- `compareAndSwap` uses a promise-tail serialization chain as its explicit
  linearization mechanism. Freshness compares both `authorityId` and opaque
  `value`, so concurrent different candidates from one base produce exactly
  one `applied` and one `conflict`.
- The linearized decision order is scope/freshness, complete-AST structural
  no-op, injected replacement failure, then replacement. Cross-authority and
  stale conflicts do not consume failure injection; a current no-op uses
  `areXnlSnapshotsStructurallyEqual` and also does not consume it; only a
  current non-noop consumes `failNextFlush`.
- Failed replacement leaves both snapshot and revision unchanged, and a retry
  from the same truthful base succeeds. Identity-authority transition coverage
  proves the authority uses the P1 comparator rather than `diffNodes`.
- Authority TDD RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-authority.test.ts`.
  Before implementation, exit `1`; `5/5` tests failed only because
  `MemoryRevisionedVfsAuthority` was absent.
- Parent-focused GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-authority.test.ts`.
  Result: exit `0`; `1` file and `6/6` tests passed.
- Comparator command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-equality.test.ts`.
  Result: exit `0`; `1` file and `18/18` tests passed.
- VFS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Coordinator expected-RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence.test.ts`.
  Result: exit `1`; all `17/17` characterization cases failed solely with
  `Expected xnl-vfs to export applyRevisionedVfsMutations`. The helper now
  identifies the remaining P2-T2 boundary independently.
- Scope check: no `applyRevisionedVfsMutations` implementation or stub, VCS
  code, packaging entry, or diff-based equality was added. `P2-T1-AC1` and
  `P2-T1-AC2` are satisfied; `P2-T1` is `DONE` while parent phase `P2`
  remains `ACTIVE` for P2-T2.
- State verification command:
  `xmllint --xpath 'concat("task=", string(//*[local-name()="Task"][@id="P2-T1"]/@status), "|checked=", count(//*[local-name()="Task"][@id="P2-T1"]//*[local-name()="Criterion"][@checked="true"]), "|unchecked=", count(//*[local-name()="Task"][@id="P2-T1"]//*[local-name()="Criterion"][@checked!="true"]), "|phase=", string(//*[local-name()="TaskGroup"][@id="P2"]/@status))' codument/tracks/active/add-xnl-revisioned-persistence-primitives/track.xml`.
  Result: exit `0`,
  `task=DONE|checked=2|unchecked=0|phase=ACTIVE`.
- Track structure command:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`,
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.

## P2-T2 Mutation-to-CAS Coordinator

- Verification timestamp: `2026-07-30T22:33:17Z`.
- Added and exported `applyRevisionedVfsMutations` from
  `packages/vfs/src/revisioned-persistence.ts`.
- The coordinator clones the caller base before strict candidate construction,
  calls `dryRunMutations` with caller options followed by the runtime
  `metadataIdMode: "identity"` override, and returns rejected diagnostics plus
  an isolated base clone without invoking the authority.
- Every applied dry-run candidate, including an empty or semantic no-op batch,
  enters `authority.compareAndSwap` with the caller's expected live revision.
  The coordinator maps authority `applied`, `unchanged`, `conflict`, and
  `failed` outcomes without performing its own freshness or equality decision.
- Candidate submissions and all exposed snapshots, revisions, receipts, and
  mutation diagnostic paths are detached from caller and authority-owned
  mutable references. An applied candidate is exposed only after the awaited
  authority result is `applied`.
- Coordinator RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence.test.ts`.
  Before implementation, exit `1`; all `17/17` tests failed only because
  `applyRevisionedVfsMutations` was absent.
- Coordinator GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence.test.ts`.
  Result: exit `0`; `1` file and `17/17` tests passed.
- Authority/equality command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-authority.test.ts revisioned-persistence-equality.test.ts`.
  Result: exit `0`; `2/2` files and `24/24` tests passed.
- VFS regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test`.
  Result: exit `0`; `19/19` files and `103/103` tests passed.
- VFS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Scope check: no `VfsMutation` bridge, VCS source, package export map, or build
  entry was added or changed by this leaf task. `P2-T2-AC1` through
  `P2-T2-AC3` are satisfied; `P2-T2` is `DONE` while parent phase `P2`
  remains `ACTIVE` for its configured phase-after hook.

## P2 Phase Attractor Gap

- Fresh phase-after review reproduced an ABA revision-token reuse:
  a custom factory emitting `r0 -> r1 -> r0` made the original stale `r0`
  current again and allowed it to overwrite the snapshot.
- P2-T1 was reopened. The authority must reject every token value previously
  issued by the same authority, not only a value equal to the immediate
  current revision.

## P2 Phase Gate

- The ABA regression now rejects nonconsecutive token reuse without advancing
  snapshot or sequence; the original stale token remains a conflict.
- Parent reran 42 focused tests and VFS typecheck successfully.
- A fresh phase-after rerun returned `PASS`; P2 is closed.

## P2-T1 ABA Revision Reuse Correction

- Verification timestamp: `2026-07-30T22:48:14Z`.
- Added an authority regression where an injected factory emits
  `r0 -> r1 -> r0`. It requires the nonconsecutive duplicate to return a
  `failed` diagnostic, preserve the `r1` snapshot and revision, retry the same
  sequence, and keep the original stale `r0` conflicting.
- RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-authority.test.ts`.
  Before the fix, exit `1`; the new case observed `applied` instead of
  `failed`, reproducing the ABA overwrite.
- `MemoryRevisionedVfsAuthority` now records every revision value actually
  issued during its lifetime. A generated value already in that set fails
  before the clock or state commit; snapshot, revision, and sequence remain
  unchanged. A value is added only after a successful CAS, so ordinary
  factory or clock failures retain truthful retry behavior.
- Focused authority GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-authority.test.ts`.
  Result: exit `0`; `1/1` file and `7/7` tests passed.
- Authority/equality/coordinator command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-authority.test.ts revisioned-persistence-equality.test.ts revisioned-persistence.test.ts`.
  Result: exit `0`; `3/3` files and `42/42` tests passed.
- VFS full test command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test`.
  Result: exit `0`; `19/19` files and `104/104` tests passed.
- VFS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Scope check: runtime changes are limited to
  `MemoryRevisionedVfsAuthority`; test changes are limited to its authority
  suite. Default revision factory behavior remains unchanged. `P2-T1-AC2` is
  restored, `P2-T1` is `DONE`, and parent phase `P2` remains `ACTIVE` pending
  its phase-after hook rerun.

## P3-T1 Lossless Tree Round-trip Characterization

- Verification timestamp: `2026-07-30T23:16:01Z`.
- Added `packages/vcs/tests/lossless-tree-characterization.test.ts`; no
  production VCS codec, repository, serializer, package export, or VFS source
  was changed.
- Legacy characterization covers current unversioned `buildTree` /
  `readTreeSnapshot` behavior:
  - explicit root and child `#id` Word fields are dropped, while legacy
    `metadata.id` fallback identity remains readable;
  - same-named metadata and attributes business keys are merged into restored
    `attributes`, with attributes taking precedence for duplicate keys;
  - unversioned legacy tree objects remain readable through the existing
    fallback path.
- The v2 fixture covers DataElement, TextElement, Comment, Word, string,
  number, boolean, null, array, plain object, `TextElement.text`,
  `TextElement.textMarker`, explicit `#id`, overlapping metadata/attributes
  keys, optional-field presence differences, body order, root Extend order and
  file Extend order. The test calls the public
  `xnl-vfs.areXnlSnapshotsStructurallyEqual` comparator so the characterization
  cannot drift into a second equality semantics.
- RepositorySnapshot characterization manually stores a tree object carrying
  `xnlVfsFormat="xnl-vfs-v2"` plus a complete AST payload, then verifies the
  future node and string serializers must preserve that marker/payload so
  `restoreRepositoryFromSnapshot` can keep the original object id and exact
  checkout equality.
- Focused expected-RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `1`; Vitest collected `6` tests. The `3` legacy tests passed.
  The `3` v2 tests failed for the intended missing implementation boundaries:
  absent `buildLosslessTree` / `readLosslessTreeSnapshot`, and current
  RepositorySnapshot node/string serializers dropping tree `metadata`,
  `xnlVfsFormat`, and `xnlVfsSnapshot` before restore can preserve object ids.
- VCS typecheck command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`; the characterization is syntactically
  and type-wise collectable.
- Neighboring regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test tree-conversion.test.ts xnl-snapshot.test.ts repository-core.test.ts`.
  Result: exit `0`; `3/3` files and `6/6` tests passed.
- Scope check: this leaf task only added characterization tests and updated its
  Codument evidence/status. It deliberately did not implement v2 tree codec,
  RepositorySnapshot v2 preservation, exact checkout, commitSnapshot, or
  revisioned repository adapter behavior. `P3-T1-AC1` through `P3-T1-AC3` are
  satisfied as characterization; phase `P3` remains `ACTIVE` for P3-T2.

## P3-T1 Parent Spot-check Correction

- Verification timestamp: `2026-07-30T23:19:36Z`.
- Parent spot-check reopened `P3-T1` because
  `packages/vcs/tests/lossless-tree-characterization.test.ts` copied
  `compareStructuralValues` / `areSnapshotsStructurallyEqual`, creating a
  second equality semantics instead of using the public VFS comparator.
- Corrected the test to import and call
  `areXnlSnapshotsStructurallyEqual` directly from `xnl-vfs`. The test no
  longer contains local `compareStructuralValues` or
  `areSnapshotsStructurallyEqual` definitions.
- Added the test-only declaration
  `packages/vcs/tests/xnl-vfs-revisioned-persistence.d.ts` so the VCS package
  typecheck can see the public `xnl-vfs` comparator through its current package
  type surface. This does not implement or duplicate comparator behavior.
- Focused expected-RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `1`; Vitest collected `6` tests. The same `3` legacy tests
  passed and the same `3` v2 tests failed at the intended missing codec /
  serializer boundaries.
- VCS typecheck command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Neighboring regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test tree-conversion.test.ts xnl-snapshot.test.ts repository-core.test.ts`.
  Result: exit `0`; `3/3` files and `6/6` tests passed.
- Track structure command:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`,
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- State verification command:
  `xmllint --xpath 'concat("task=", string(//*[local-name()="Task"][@id="P3-T1"]/@status), "|checked=", count(//*[local-name()="Task"][@id="P3-T1"]//*[local-name()="Criterion"][@checked="true"]), "|unchecked=", count(//*[local-name()="Task"][@id="P3-T1"]//*[local-name()="Criterion"][@checked!="true"]), "|phase=", string(//*[local-name()="TaskGroup"][@id="P3"]/@status))' codument/tracks/active/add-xnl-revisioned-persistence-primitives/track.xml`.
  Result: exit `0`, `task=DONE|checked=3|unchecked=0|phase=ACTIVE`.

## P3-T2 Corrective Spot-Check Closure

- Verification timestamp: `2026-07-30T23:42:40Z`.
- Corrected the v2 checkout boundary in `packages/vcs/src/tree-converter.ts`:
  `checkoutTree` now loads the decoded exact v2 snapshot into `Repository.vfs`
  instead of loading the legacy projection. Unmarked legacy tree objects still
  take the existing fallback decoder path.
- Tightened `packages/vcs/tests/lossless-tree-characterization.test.ts` so the
  v2 fixture no longer places non-VFS `DataElement` nodes directly in
  `folder.body`. Direct folder children are legal VFS folders/files; arbitrary
  body coverage remains via `TextElement`, `Comment`, `Word`, primitives,
  arrays, and objects, and optional DataElement presence/absence is covered as
  nested XNL values under metadata/attributes.
- P3 characterization now asserts both the original repository checkout and the
  capture -> node/string serialize -> restore path have
  `repository.vfs.getSnapshot()` structurally equal to the full source via
  `areXnlSnapshotsStructurallyEqual`, and asserts `status().clean` for those
  checkout/restore states.
- Added malformed v2 marker/payload coverage for raw tree objects and serialized
  repository snapshot Tree nodes. Unsupported `xnlVfsFormat` and missing v2
  payload throw `VcsError` with `code="EINVAL"` instead of silently falling back
  to legacy entries; no-marker legacy fallback remains covered by the existing
  legacy readability case.
- Focused P3 command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `0`; `1/1` files and `8/8` tests passed.
- Tree/xnl/repository regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test tree-conversion.test.ts tree-conversion-errors.test.ts xnl-snapshot.test.ts repository-core.test.ts`.
  Result: exit `0`; `4/4` files and `7/7` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0`.
- VFS full test command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test`.
  Result: exit `0`; `19/19` files and `104/104` tests passed.
- VCS full test command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test`.
  Result: exit `1` with only the expected P4/P5 RED in
  `tests/revisioned-repository.test.ts`: `3/3` failures report the missing
  `RevisionedRepositoryAdapter` export. All other `21/22` files and `47/50`
  tests passed. No P4/P5 implementation was attempted.
- Scope check: this corrective pass changed only the P3 codec behavior,
  characterization, and P3-T2 evidence/status. It did not change
  `folderChildren`/VFS path-index semantics, package configuration, or P4/P5
  runtime behavior. The user hard semantic remains preserved: `#id` participates
  in diff alignment/move identity, not as ordinary payload update.

## P3 Phase Attractor Gap: Present Undefined Fields

- A fresh phase-after review found that the first v2 payload stored the raw AST
  through `JSON.stringify` / `JSON.parse` and the object-store canonicalizer.
  Those processors delete own properties whose value is `undefined`.
- This conflicts with the public authority comparator, which treats own-key
  presence as structural semantics. In particular, absent `id`, `body`,
  `TextElement.text`, or `TextElement.textMarker` is distinct from the same
  property being present with `undefined`.
- The reviewer reproduced a v2 round-trip where those keys disappeared and
  `areXnlSnapshotsStructurallyEqual` returned `false`, even though the existing
  eight P3 tests passed.
- P3-T2 is reopened. Closure requires one versioned JSON-safe tagged AST
  encoding shared by the tree store and RepositorySnapshot node/string path,
  plus checkout clone boundaries that preserve explicit `undefined`.

## P3-T2 Corrective Undefined-Presence Closure

- Verification timestamp: `2026-07-30T23:59:46Z`.
- Added a single versioned JSON-safe tagged AST codec in
  `packages/vcs/src/lossless-ast-codec.ts`. It explicitly encodes
  `undefined`, `null`, booleans, strings, numbers, arrays, and plain-object own
  keys. Object entries are sorted during encoding; array/body/Extend order is
  preserved. `-0`, `NaN`, `Infinity`, and `-Infinity` round-trip through number
  tags instead of being silently coerced by JSON.
- The codec rejects non-XNL data with `VcsError` `code="EINVAL"`: cycles,
  functions, symbols, bigints, non-plain objects, symbol keys, non-enumerable or
  accessor properties, sparse arrays, custom array properties, duplicate
  encoded object keys, and malformed encoded number/object/array payloads.
- `TreeObject` v2 payload now stores the encoded value in the existing
  `xnlVfsSnapshot` slot rather than raw `DataElementNode`. `buildLosslessTree`
  encodes once; readers decode, verify the result is a legal VFS folder root,
  and return a detached raw AST clone. Unmarked legacy tree objects still use
  the existing fallback projection.
- `RepositorySnapshot` node and string serializers now pass through that same
  encoded payload. They validate that the payload decodes to a legal v2 VFS root
  but do not invent a second tree/snapshot encoding. Capture -> serialize ->
  deserialize -> restore keeps the v2 object id stable.
- `VirtualFileSystem` constructor, `getSnapshot`, and `loadSnapshot` now use
  `structuredClone` so checkout/load boundaries preserve own properties whose
  value is explicitly `undefined`.
- P3 characterization was strengthened so the source includes root own
  `id: undefined`, a VFS folder own `body: undefined`, nested DataElement own
  `body: undefined`, TextElement own `text: undefined` and
  `textMarker: undefined`, plus `-0`, `NaN`, and infinities. It still covers
  DataElement/TextElement/Comment/Word, primitives, arrays, objects, Extend
  order, legacy fallback, malformed v2 markers, checkout, capture node/string
  restore, object id stability, and clean status.
- The previous manual raw v2 fixture now creates the tree through
  `buildLosslessTree`, so tests no longer bypass the production codec. Raw AST
  payload under the v2 marker, malformed encoded payloads, and non-XNL runtime
  values are covered as `EINVAL`.
- Removed the temporary VCS test declaration for `xnl-vfs`; before VCS
  verification, `xnl-vfs` dist was explicitly rebuilt so VCS tests consumed the
  real current package type/runtime surface. Ignored dist output was not
  staged or committed.
- Focused VFS regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test vfs-clone-presence.test.ts`.
  Result: exit `0`; `1/1` file and `1/1` test passed.
- VFS focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence.test.ts revisioned-persistence-authority.test.ts revisioned-persistence-equality.test.ts vfs-clone-presence.test.ts`.
  Result: exit `0`; `4/4` files and `43/43` tests passed.
- VFS full command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test`.
  Result: exit `0`; `20/20` files and `105/105` tests passed.
- VFS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs lint`.
  Result: exit `0` with `tsc --noEmit`.
- VFS build command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs build`.
  Result: exit `0`; tsup ESM/CJS/DTS build succeeded.
- P3 focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `0`; `1/1` file and `9/9` tests passed.
- VCS tree/xnl/repository regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test tree-conversion.test.ts tree-conversion-errors.test.ts xnl-snapshot.test.ts repository-core.test.ts lossless-tree-characterization.test.ts`.
  Result: exit `0`; `5/5` files and `16/16` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- VCS full command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test`.
  Result: exit `1` with only the expected P4/P5 RED in
  `tests/revisioned-repository.test.ts`: `3/3` failures report the missing
  `RevisionedRepositoryAdapter` export. All other `21/22` files and `48/51`
  tests passed.
- Scope check: this corrective pass changed only the v2 lossless codec,
  RepositorySnapshot payload preservation, VFS clone boundary, P3/VFS
  regressions, and P3-T2 evidence/status. It did not implement P4/P5, did not
  change package exports, and did not change the hard identity semantic:
  element `#id` remains a diff alignment/move identity, not ordinary update
  payload.

## P3-T2 Parent Spot-check Gap: Arbitrary Own String Keys

- The parent adversarial probe encoded metadata created from
  `{"__proto__":"domain-value"}`. The source had an own `__proto__` key, but
  decode assigned through `out[key]`, invoked the prototype setter, and
  returned an object without that own key.
- This violates the codec's arbitrary own-string-key and structural-equality
  promise and is also a prototype-pollution boundary.
- The same review found that semantic object keys were ordered with
  `localeCompare`; because the encoded entries are an array included in the
  content hash, canonical ObjectId order must use a locale-independent
  comparator.
- P3-T2 is reopened for explicit data-property restoration, reserved-key
  regression coverage, and deterministic key-order verification.

## P3 Phase Attractor Gap: Malformed Encoded Arrays

- The second fresh phase review confirmed the undefined/reserved-key fixes but
  found decoder validation asymmetric with the encoder.
- A hand-built encoded `array.items` containing a sparse hole or custom
  property passed decode and could reintroduce a sparse body through
  `readTreeSnapshot`, although the encoder rejects the same runtime shape.
- P3-T2 is reopened to reuse the array-shape validator on encoded `items` and
  to prove direct decode plus v2 tree read both return `EINVAL`.

## P3 Phase Attractor Gap: Inherited And Non-Canonical Tags

- The third fresh review found that decoder records were only checked for
  object-ness. A crafted transport object could inherit `type` or `entries`
  from its prototype, and tag objects with ignored extra fields were accepted.
- The public snapshot decoder also returned decoded primitives without
  asserting that the final value is a valid VFS folder root.
- P3-T2 is reopened for an exact transport grammar: plain own enumerable data
  properties only, exact key sets per value tag and object entry, no inherited
  fields, and root validation in `decodeLosslessVfsSnapshot` itself.

## P3 Phase Gate

- Exact transport grammar now rejects inherited, accessor, non-enumerable,
  symbol, extra, missing, sparse, custom-array, duplicate-key, and non-root
  payload shapes with `EINVAL`.
- The final parent probes confirmed reserved own keys, explicit undefined
  presence, array data descriptors, canonical key order, exact checkout, and
  RepositorySnapshot node/string ObjectId stability.
- Focused P3/VFS tests and lint pass; the only VCS full-suite failures remain
  the three intentional P4/P5 `RevisionedRepositoryAdapter` characterization
  cases.
- A fourth fresh phase-after AttractorCheck returned `PASS`; P3 is closed.

## P4-T1 Parent Spot-check Gap: Legacy Detached Commit Side Effects

- Focused P4 tests passed, but the parent compatibility probe checked a dirty
  detached worktree before and after legacy `Repository.commit()`.
- The refactor moved `buildTree` before the detached-HEAD guard. The call still
  threw `EDETACHEDHEAD`, but object-store size grew from `3` to `5`, leaving two
  unreachable objects that the previous implementation never created.
- P4-T1 is reopened to restore guard-before-tree ordering and add a regression
  that locks both the error code and no-new-object behavior.

## P3-T2 Corrective Spot-check Closure

- Verification timestamp: `2026-07-31T00:07:42Z`.
- `packages/vcs/src/lossless-ast-codec.ts` now decodes every object entry with
  `Object.defineProperty(..., enumerable/writable/configurable data property)`.
  Reserved own keys including `__proto__`, `constructor`, and `prototype` are
  restored as own data properties and do not write through prototype setters.
- The lossless AST encoder now sorts object keys with UTF-16/code-unit string
  comparison instead of `localeCompare`. `packages/vcs/src/hash.ts` uses the
  same locale-independent comparator for content-addressed object
  canonicalization, so equal semantic tree payloads get equal ObjectIds.
- `packages/vcs/tests/lossless-tree-characterization.test.ts` now covers
  JSON-created and `defineProperty`-created reserved own keys through
  `buildLosslessTree`/`readTreeSnapshot`, `checkoutTree`,
  `VirtualFileSystem.getSnapshot`, `RepositorySnapshot` node restore, and
  `RepositorySnapshot` string restore. Each restored snapshot is
  identity-sensitive comparator equal to the source and retains own key/value
  descriptors.
- The P3 characterization now verifies that different object insertion orders
  produce identical lossless encoded payloads and identical v2 tree ObjectIds,
  including a code-unit order assertion for `A`, `__proto__`, `a`, reserved
  keys, `z`, and `ä`.
- Duplicate encoded object entries still throw `VcsError` `EINVAL`; malformed
  number payloads and object entries missing `value` still throw `EINVAL`.
  Existing unsupported runtime value, sparse array, symbol key, custom array
  property, cycle, and malformed v2 tree guards remain in the suite.
- P3 focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `0`; `1/1` file and `12/12` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- VFS clone/equality command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-equality.test.ts vfs-clone-presence.test.ts`.
  Result: exit `0`; `2/2` files and `19/19` tests passed.
- Scope check: this corrective pass changed only P3 codec/canonical ordering
  and P3 characterization/evidence. It did not implement P4/P5, did not change
  package exports, did not submit a commit, and did not alter the hard identity
  semantic: element `#id` remains for diff alignment/move, not ordinary payload
  update.

## P3-T2 Corrective Malformed Encoded Array Closure

- Verification timestamp: `2026-07-31T00:20:31Z`.
- `packages/vcs/src/lossless-ast-codec.ts` now reuses the array shape
  validator when decoding encoded `{ type: "array", items }` payloads. Encoded
  `items` must be a dense array with no custom own string properties and no
  symbol properties before any child values are mapped.
- The shared validator now checks own string property names instead of only
  enumerable keys, allowing array indices and `length` only. This preserves the
  normal encoder payload shape while making encoder and decoder malformed-array
  rejection symmetric.
- `packages/vcs/tests/lossless-tree-characterization.test.ts` now covers
  sparse, custom-string-property, and symbol-property encoded `items` arrays in
  both direct `decodeLosslessVfsSnapshot` calls and v2 `TreeObject`
  `readTreeSnapshot` calls. Each path throws `VcsError` `EINVAL`.
- Existing malformed payload guards remain covered: duplicate encoded object
  keys, malformed number encodings, object entries missing `value`, reserved
  own keys, explicit `undefined`, special numbers, unsupported runtime values,
  cycles, legacy fallback, and malformed v2 tree object markers/payloads.
- P3 focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `0`; `1/1` file and `15/15` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- VFS clone/equality command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-equality.test.ts vfs-clone-presence.test.ts`.
  Result: exit `0`; `2/2` files and `19/19` tests passed.
- Scope check: this corrective pass changed only the v2 lossless array decoder
  guard, focused P3 characterization, and P3-T2 evidence/status. It did not
  change normal encoder data shape, hashes, P4/P5, package exports, or the hard
  identity semantic: element `#id` remains for diff alignment/move, not ordinary
  payload update.

## P3-T2 Corrective Malformed Encoded Object Entries Closure

- Verification timestamp: `2026-07-31T00:27:43Z`.
- `packages/vcs/src/lossless-ast-codec.ts` now applies the same transport array
  shape validator to encoded `{ type: "object", entries }` arrays before
  iterating object entries. Sparse holes, custom own string properties, and
  symbol properties on `entries` throw `VcsError` `EINVAL` instead of being
  skipped or silently ignored by decoder iteration.
- `packages/vcs/tests/lossless-tree-characterization.test.ts` now includes
  malformed encoded object `entries` cases for sparse, custom-string-property,
  and symbol-property transport arrays, alongside the existing duplicate-key,
  missing-value, malformed-number, and malformed encoded array `items` guards.
- P3 focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `0`; `1/1` file and `18/18` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- VFS clone/equality command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-equality.test.ts vfs-clone-presence.test.ts`.
  Result: exit `0`; `2/2` files and `19/19` tests passed.
- Codument validation command:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`; `track.xml OK + 1 behavior delta(s)`.
- Scope check: this corrective pass only extended the v2 lossless decoder's
  symmetric transport array validation from encoded `items` to encoded
  `entries` and added focused characterization. It did not change normal
  encoder data shape, hashes, P4/P5, package exports, or the hard identity
  semantic: element `#id` remains for diff alignment/move, not ordinary payload
  update.

## P3-T2 Corrective Exact Transport Grammar Closure

- Verification timestamp: `2026-07-31T00:37:58Z`.
- `packages/vcs/src/lossless-ast-codec.ts` now validates every encoded value
  record and encoded object entry record as a plain object with `Object`
  prototype or null prototype, no own symbol keys, and only enumerable data
  descriptors. Inherited `type`, `entries`, `key`, or `value` fields are not
  read.
- The decoder now enforces exact own-key sets for every transport tag:
  `undefined`/`null` use only `type`; `boolean`/`string`/`number` use
  `type,value`; `array` uses `type,items`; `object` uses `type,entries`; object
  entries use `key,value`. Extra fields, missing own required fields, accessors,
  non-enumerable fields, and symbol fields all throw `VcsError` `EINVAL`.
- The encoded `items`/`entries` array validator remains in force and now also
  rejects accessor or non-enumerable array index transport properties before
  mapping child values.
- Public `decodeLosslessVfsSnapshot` now validates the decoded value itself is a
  VFS folder snapshot root: own `kind="DataElement"`, `tag="folder"`, object
  `metadata`, and non-empty string own `metadata.id` plus `metadata.name`.
  Direct primitive/array/generic object decode and crafted v2 tree payloads now
  fail with `EINVAL`. Explicit element `id: undefined` remains legal and is
  preserved because `#id` is diff alignment/move identity, not the metadata
  address fallback.
- `packages/vcs/tests/lossless-tree-characterization.test.ts` now covers
  inherited `type`/`entries`/entry `value`, extra tag fields, accessor,
  non-enumerable, and symbol transport record properties, missing own required
  fields, direct non-root public decode, missing/empty root metadata address
  fields, and equivalent crafted v2 `readTreeSnapshot` payloads via a custom
  `ObjectStore`.
- P3 focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts`.
  Result: exit `0`; `1/1` file and `23/23` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- VFS clone/equality command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test revisioned-persistence-equality.test.ts vfs-clone-presence.test.ts`.
  Result: exit `0`; `2/2` files and `19/19` tests passed.
- Codument validation command:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`; `track.xml OK + 1 behavior delta(s)`.
- P3-T2 is marked `DONE` with `P3-T2-AC1..AC3` checked true. Phase `P3`
  remains `ACTIVE` for parent-level continuation. Scope check: this corrective
  pass changed only exact v2 lossless transport grammar/root validation,
  focused P3 characterization, and P3-T2 evidence/status. It did not change
  hashes, P4/P5, package exports, or commit anything.

## P4-T1 Repository.commitSnapshot

- Verification timestamp: `2026-07-31T00:52:30Z`.
- Added public `Repository.commitSnapshot(snapshot, message, options?)` in
  `packages/vcs/src/repository.ts` with exported
  `CommitSnapshotHistoryState`, `RepositoryCommitSnapshotOptions`, and
  `RepositoryCommitSnapshotResult` closed-union types.
- `commitSnapshot` clones the public worktree before staging, stages a clone of
  the caller-provided authority snapshot, and creates the checkpoint tree only
  through `buildLosslessTree`. Legacy `Repository.commit()` keeps its existing
  signature and still uses legacy `buildTree`.
- Commit object construction is shared through a private tree-commit helper,
  but P4 classification does not reuse legacy `commit()`'s
  ObjectId-or-throw result. Candidate commit id is captured at object creation
  time, and commit invocation errors classify history from observed head
  evidence rather than assuming rollback.
- Public worktree restoration runs after every path. When the Repository backend
  exposes both workspace read/write capability, the original workspace state is
  captured and restored; temporary exact-snapshot staging is not persisted into
  backend workspace state. A `committed` result is returned only after restore
  succeeds.
- The closed union now distinguishes:
  - `committed` with `headBefore`, `observedHead`,
    `historyState="accepted"`, and `worktreeState="restored"`;
  - `failed` for `stage|pre-commit` before commit invocation, with
    `historyState="not-started"` and restored worktree;
  - `indeterminate` for `commit|restore`, including optional
    `candidateCommitId`, truthful `historyState`, restored-or-unknown
    `worktreeState`, and frozen stable diagnostics.
- Added `packages/vcs/tests/repository-commit-snapshot.test.ts`. The success
  case proves an out-of-band public worktree file is restored and not included
  in the checkpoint, the committed tree carries `xnlVfsFormat="xnl-vfs-v2"`,
  and `readLosslessTreeSnapshot` returns the authority snapshot. The boundary
  case proves detached HEAD returns a restored `pre-commit` failure with
  observed head evidence and diagnostics.
- P4 focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-commit-snapshot.test.ts`.
  Result: exit `0`; `1/1` file and `2/2` tests passed.
- P3/repository regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts tree-conversion.test.ts tree-conversion-errors.test.ts xnl-snapshot.test.ts repository-core.test.ts repository-commit-snapshot.test.ts`.
  Result: exit `0`; `6/6` files and `32/32` tests passed.
- Repository core command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-core.test.ts`.
  Result: exit `0`; `1/1` file and `2/2` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- VCS full command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test`.
  Result: exit `1` with only the expected P5 RED in
  `tests/revisioned-repository.test.ts`: `3/3` failures report the missing
  `RevisionedRepositoryAdapter` export. All other `22/23` files and `64/67`
  tests passed.
- Scope check: this leaf task changed only Repository exact-snapshot behavior,
  its focused tests, and Codument evidence/status. It did not implement P4-T2
  failure injection hooks, P5 adapter/flush behavior, package exports, or any
  git commit. The hard identity semantic remains unchanged: element `#id`
  participates in diff alignment/move identity, not ordinary payload update.

## P4-T1 Corrective Legacy Detached Commit Closure

- Verification timestamp: `2026-07-31T00:58:48Z`.
- Restored legacy `Repository.commit()` ordering in
  `packages/vcs/src/repository.ts`: detached HEAD is rejected before
  `buildTree(...)`, content writes, object-store writes, branch movement, or
  backend workspace persistence. The thrown `VcsError` keeps code
  `EDETACHEDHEAD` and message `Cannot commit while HEAD is detached`.
- Added `packages/vcs/tests/repository-commit-snapshot.test.ts` legacy
  compatibility coverage. The dirty detached worktree regression records
  `repository.store.list()` and a spy `ContentStore.put` count before
  `commit()`, then asserts the thrown error code/message and exact object id
  list/call-count equality after the failure.
- The same focused suite now includes a normal branch legacy commit check:
  public signature remains `ObjectId`, author/message/parents are unchanged,
  the branch head advances to the returned id, and the spy content store sees
  exactly one file content write for a one-file commit, proving the branch path
  did not double-build the tree.
- P4 focused command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-commit-snapshot.test.ts`.
  Result: exit `0`; `1/1` file and `4/4` tests passed.
- Repository/errors/tree regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-commit-snapshot.test.ts repository-core.test.ts repository-core-errors.test.ts tree-conversion.test.ts tree-conversion-errors.test.ts xnl-snapshot.test.ts`.
  Result: exit `0`; `6/6` files and `12/12` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- P4-T1 is marked `DONE` with `P4-T1-AC1` and `P4-T1-AC2` checked true. Phase
  `P4` remains `ACTIVE` for P4-T2. Scope check: this corrective pass changed
  only legacy commit guard ordering, P4 focused tests, and Codument evidence.
  It did not enter P4-T2 injection matrices, P5 adapter work, package exports,
  dist files, or any git commit. The hard identity semantic remains unchanged:
  element `#id` participates in diff alignment/move identity, not ordinary
  payload update.

## P4-T2 Staging, Commit, And Restore Failure Matrix

- Verification timestamp: `2026-07-31T04:23:12+03:00`.
- Test-first RED reproduced two boundary defects:
  - a failing public `VirtualFileSystem.getSnapshot()` escaped
    `Repository.commitSnapshot()` instead of producing a closed result;
  - a commit-object `ObjectStore.put()` failure with unchanged HEAD was
    classified as `indeterminate/commit/possibly-accepted` even though history
    acceptance had provably not started.
- `Repository.commitSnapshot()` now captures the public worktree inside its
  closed boundary and records separate internal facts for staging attempted,
  commit attempted, candidate commit identity, and in-memory history
  acceptance. A commit attempt alone no longer implies possible acceptance.
- The fault-injection matrix in
  `packages/vcs/tests/repository-commit-snapshot.test.ts` now proves:
  - public worktree capture, backend workspace capture, staging load, and
    lossless tree build failures return `failed/stage`, with
    `historyState="not-started"` and `worktreeState="restored"`;
  - detached HEAD and commit-object storage failures with unchanged observed
    HEAD return `failed/pre-commit`, not an indeterminate commit result;
  - backend ref failure after the in-memory branch accepts the candidate
    returns `indeterminate/commit`, preserves the candidate/head evidence, and
    reports `historyState="accepted"`;
  - public worktree or backend workspace restore failure always overrides the
    primary result with `indeterminate/restore` and
    `worktreeState="unknown"`;
  - a detached-HEAD pre-commit error followed by backend workspace restore
    failure preserves both diagnostics while truthfully retaining
    `historyState="not-started"`.
- `headBefore` and `observedHead` are observed before/after the operation on
  every result path. The capture-failure case explicitly verifies that `null`
  means a known unborn branch, not an unobserved head.
- Focused RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-commit-snapshot.test.ts`.
  Initial result: exit `1`; `11/13` passed. The two expected failures were the
  escaped public capture error and the over-broad commit acceptance
  classification described above.
- Focused GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-commit-snapshot.test.ts`.
  Result: exit `0`; `1/1` file and `13/13` tests passed.
- Repository/lossless regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test repository-commit-snapshot.test.ts repository-core.test.ts repository-core-errors.test.ts tree-conversion.test.ts tree-conversion-errors.test.ts xnl-snapshot.test.ts lossless-tree-characterization.test.ts`.
  Result: exit `0`; `7/7` files and `44/44` tests passed.
- Legacy detached side-effect probe returned
  `{"code":"EDETACHEDHEAD","before":3,"after":3,"unchanged":true}`.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Scope check: P4-T2 is `DONE` with both acceptance criteria checked; P4 remains
  `ACTIVE` for the parent phase attractor check. This task did not enter P5 or
  P6, did not change package exports, and did not commit. The XNL identity
  contract is unchanged: diff uses element `#id` for tree alignment and move
  detection, does not emit it as an ordinary payload-field update, and identity
  replacement remains delete plus add.

## P4 Phase Attractor Check

- Verification timestamp: `2026-07-31T01:33:32Z`.
- A fresh read-only reviewer returned `PASS`: the exact v2 checkpoint,
  worktree/workspace restoration, closed failure union, pre-commit acceptance
  boundary, backend-after-memory acceptance evidence, restore override, and
  legacy commit ordering all match the P4 design and behavior delta.
- Parent verification reran the 13-test commitSnapshot matrix, repository core
  regressions, VCS lint, and strict Codument validation. The full VCS suite had
  `75/78` tests green; the only three RED cases are the deliberately pending P5
  `RevisionedRepositoryAdapter` characterization tests.
- Residual coverage noted by the reviewer is non-blocking: a combined
  commit-primary-plus-restore failure and two simultaneous restore failures are
  not separate test cases, while the implementation already aggregates all
  diagnostics. Full AST exactness is owned by and covered in the P3 codec suite.
- P4 is `DONE`; P5 is now `ACTIVE`. The hard identity contract remains that
  `#id` aligns nodes and detects moves, is not emitted as an ordinary field
  update, and identity replacement is delete plus add.

## P5-T1 RevisionedRepositoryAdapter open/apply

- Verification timestamp: `2026-07-31T01:43:36Z`.
- Added `packages/vcs/src/revisioned-repository.ts` with public adapter options,
  open/apply input and result types, and `RevisionedRepositoryAdapter`.
  `open()` clones the authority revision-plus-snapshot pair before projecting
  it into the Repository public worktree and returns a separate clone, so even
  an authority that returns its own mutable reference is not leaked.
- `apply()` delegates candidate construction, strict mutation validation,
  semantic no-op handling, CAS, and closed result classification directly to
  `applyRevisionedVfsMutations(authority, input)`. It loads the accepted
  snapshot into the Repository only for `status="applied"`; unchanged,
  conflict, rejected, and failed paths do not touch the public worktree,
  branch head, or object history.
- Added six focused tests covering open/reference isolation, applied projection,
  unchanged with an out-of-band worktree, stale conflict, strict identity
  rejection before authority invocation, and authority failure. Every
  non-applied case captures and compares the worktree, head, and object-store
  ids. Open/apply results contain the real live revision/receipt and no commit
  identity.
- Initial RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test revisioned-repository-apply.test.ts`.
  Result: exit `1`; the expected adapter source module did not exist.
- Focused GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test revisioned-repository-apply.test.ts`.
  Result: exit `0`; `1/1` file and `6/6` tests passed.
- VCS lint command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- The pre-existing P5-T2 checkpoint characterization remains deliberately RED:
  `revisioned-repository.test.ts` reports `3/3` failures because
  `adapter.checkpoint` is not yet a function. Its reflection cast now crosses
  an explicit `unknown` boundary so the pending runtime characterization does
  not make P5-T1 typechecking fail.
- P5-T1 is `DONE` with both acceptance criteria checked; P5 remains `ACTIVE`.
  This task did not implement checkpoint, backend flush, package subpath
  exports, or commit. The hard XNL identity contract is unchanged: diff uses
  `#id` for tree alignment and move detection, does not emit `#id` as an
  ordinary payload-field update, and identity replacement is delete plus add.

## P5-T2 Checkpoint Classification And Bound Backend Flush

- Verification timestamp: `2026-07-31T02:08:47Z`.
- `RevisionedRepositoryAdapter.checkpoint()` now reads one authority
  revision-plus-snapshot pair, rejects stale and cross-authority revisions
  before history creation, and maps authority read failure to
  `failed/read` with explicit `ObjectId|null` head evidence.
- Matching revisions enter `Repository.commitSnapshot()`. Repository
  stage/pre-commit failures map to `failed/pre-commit`; commit and restore
  indeterminate outcomes preserve their history, worktree, candidate commit,
  and observed-head evidence.
- Successful commits are read back with `readLosslessTreeSnapshot()` and
  compared using `areXnlSnapshotsStructurallyEqual()`. Unreadable trees and
  structural mismatches, including an explicit-`#id`-only mismatch, return
  `indeterminate/post-commit-verify`.
- `RepositoryBackend` now has optional awaitable `flush()`.
  `Repository.flushBoundBackend()` invokes it only when both active stores are
  the backend-owned ports by reference identity. Bound success reports
  `backend-flushed`; missing capability or either mixed store override reports
  `memory-accepted`; a flush throw reports `indeterminate/flush`.
  Checkpoint options expose only `author`, and a runtime-injected unrelated
  flush function is ignored.
- Focused P4/P5 verification:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test revisioned-repository.test.ts revisioned-repository-apply.test.ts repository-commit-snapshot.test.ts`.
  Parent-confirmed result: exit `0`; `3/3` files and `36/36` tests passed.
- Full VCS regression:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test`.
  Result: exit `0`; `24/24` files and `98/98` tests passed.
- VCS lint:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Strict Codument validation:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`;
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- P5-T2 is `DONE` with all four acceptance criteria checked; P5 remains
  `ACTIVE` for its phase-level closeout. P6, package subpath exports, dist
  artifacts, and git history were not touched. The hard XNL identity contract
  remains unchanged: `#id` is used for diff alignment and move identity, not
  an ordinary field update, and identity replacement remains delete plus add.

## P5-T2 Parent Spot-Check Reopen

- Observation timestamp: `2026-07-31T02:15:44Z`.
- The parent spot-check found that `checkpoint()` reused
  `commitResult.observedHead` when an awaitable backend `flush()` failed.
  Another repository operation can advance HEAD while that flush promise is
  pending, so the returned value can be stale rather than the head observed
  after the failing phase.
- P5-T2 is reopened and AC3/AC4 are unchecked until a deferred-flush
  characterization proves the failure result re-observes the current
  `ObjectId|null` head. The accepted checkpoint candidate and later head must
  remain distinct evidence rather than forcing `observedHead` to equal
  `candidateCommitId`.

## P5 Phase Attractor Check Gap

- Observation timestamp: `2026-07-31T03:14:37Z`.
- A fresh phase reviewer reproduced that
  `readLosslessTreeSnapshot()` delegated to the general tree reader and
  therefore accepted a markerless legacy tree through fallback. If that legacy
  projection happened to compare structurally equal, checkpoint returned
  `checkpointed` without proving the required `xnl-vfs-v2` exact encoding.
- P5-T2 is reopened and AC1/AC3 are unchecked. The corrective boundary is:
  general `readTreeSnapshot()` keeps legacy compatibility, while the explicitly
  named lossless reader must reject missing, unsupported, or malformed v2
  markers/payloads. Adapter verification must classify that rejection as
  `indeterminate/post-commit-verify`.

## P5 Phase Attractor Check Closure

- Verification timestamp: `2026-07-31T03:31:35Z`.
- A second fresh phase reviewer returned `PASS` after the strict v2 correction.
  It confirmed the authority boundary for open/apply, the checkpoint result
  union, strict v2 read-back plus identity-sensitive equality, live revision
  versus commit identity separation, bound-backend durability proof, and
  deferred-flush head re-observation.
- Parent verification passed `64/64` focused lossless/revisioned tests; the full
  VCS suite passed `103/103`, with lint and strict Codument validation green.
- P5 is `DONE`; P6 is now `ACTIVE`. General tree reads retain legacy
  compatibility, while exact checkpoint verification cannot silently take that
  fallback.

## P6-T1 Explicit Subpaths And API Documentation

- Verification timestamp: `2026-07-31T03:50:04Z`.
- Added `xnl-vfs/revisioned-persistence` and
  `xnl-vcs/revisioned-repository` package export maps and tsup entry points.
  Both generated ESM and CJS entries loaded through their package subpaths;
  a strict no-emit TypeScript smoke compiled the public runtime and type
  imports from both paths.
- Updated VFS/VCS API documentation with explicit imports, the distinct
  responsibilities of diff alignment and complete-AST structural equality,
  live revision versus commit identity, strict v2 checkpoint read-back, and
  the reference-identity proof required for `backend-flushed`.
- The documentation explicitly preserves the hard identity rule: diff reads
  `#id` to align nodes and identify moves, does not emit it as an ordinary
  payload-field update, and identity replacement is delete plus add.
- P6-T1 is `DONE`; P6-T2 is now `ACTIVE` for full package, build, import, and
  browser-safe reachability verification.

## P6 Phase Attractor Check

- Verification timestamp: `2026-07-31T04:04:58Z`.
- A fresh read-only reviewer returned `PASS`: both subpath export/build/type
  surfaces are closed, the VFS browser-safe claim is scoped only to
  `revisioned-persistence`, the VCS entry is not mislabeled browser-safe, and
  documentation preserves the identity, equality, revision, durability,
  legacy-read, and strict-v2 boundaries.
- The phase now enters configured gap-loop round 1. Because
  `verify-round="true"`, a first-round `NO_GAP` will require a second fresh
  lightweight verification round before P6 can close.

## P6 Gap-Loop Closure

- Closure timestamp: `2026-07-31T04:14:17Z`.
- Round 1 performed the full target comparison and returned `NO_GAP`; its
  evidence is in `reports/track-impl-gap-report-1.md`.
- Because the phase config sets `verify-round="true"`, round 2 used a different
  fresh reviewer in lightweight mode to recheck the round-1 conclusion against
  the latest diff. It also returned `NO_GAP`; evidence is in
  `reports/track-impl-gap-report-2.md`.
- P6 and the Track are now `DONE` / `completed`. No behavior, design, or
  implementation change was needed during the two gap-loop rounds.

## P5-T2 Parent Spot-Check Gap Closure

- Verification timestamp: `2026-07-31T02:20:15Z`.
- Added a deferred backend flush regression that starts a checkpoint, waits
  until the candidate commit is accepted and `backend.flush()` is pending,
  advances the same Repository HEAD through a normal `repository.commit()`,
  then rejects the flush.
- RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test revisioned-repository.test.ts`.
  Result: exit `1`; `17/18` tests passed. The new case observed the original
  candidate commit instead of the later concurrent commit, while all other
  expected `indeterminate/flush` evidence already matched.
- Minimal production change: the flush catch in
  `RevisionedRepositoryAdapter.checkpoint()` now calls
  `repository.getHeadCommitId()` after the rejected await. It preserves
  `candidateCommitId` as the original checkpoint commit and does not force
  `observedHead` to equal that candidate. The authority-read catch already
  re-observes HEAD after its await; no other checkpoint failure path has the
  same stale post-await observation.
- Focused GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test revisioned-repository.test.ts revisioned-repository-apply.test.ts`.
  Result: exit `0`; `2/2` files and `24/24` tests passed.
- Full VCS regression:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test`.
  Result: exit `0`; `24/24` files and `99/99` tests passed.
- VCS lint:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Strict Codument validation:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`;
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- The deferred failure result now reports `candidateCommitId` as the original
  checkpoint commit, `observedHead` as the later current HEAD,
  `historyState="accepted"`, and `worktreeState="restored"`.
- P5-T2 is `DONE` again with AC3/AC4 restored to checked. P5 remains `ACTIVE`;
  P6, package exports, dist artifacts, and git history were not touched. The
  hard XNL identity contract remains unchanged: `#id` is diff identity and
  move alignment, not a field update, and replacement is delete plus add.

## P5-T2 Exact v2 Read-Back Gap Closure

- Verification timestamp: `2026-07-31T03:22:19Z`.
- Added tree-converter characterization proving that general
  `readTreeSnapshot()` retains markerless legacy fallback, while
  `readLosslessTreeSnapshot()` rejects markerless legacy trees, unsupported
  markers, missing v2 payloads, and malformed v2 payloads with `VcsError`
  `EINVAL`; a valid `xnl-vfs-v2` payload still round-trips exactly.
- Added a `RevisionedRepositoryAdapter` regression whose Repository override
  accepts a real markerless legacy commit. The test first proves the legacy
  projection is identity-sensitive structurally equal to the authority
  snapshot, then requires `indeterminate/post-commit-verify` with the accepted
  history, candidate commit, observed HEAD, and restored worktree evidence
  preserved.
- Focused RED command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts revisioned-repository.test.ts`.
  Result: exit `1`; `43/45` tests passed. The strict reader did not reject the
  markerless tree, and checkpoint incorrectly returned `checkpointed`.
- Minimal production change: `packages/vcs/src/tree-converter.ts` now shares a
  private strict v2 decoder. The general reader invokes it only when a marker
  is present and otherwise keeps legacy fallback; the lossless reader reads
  the `TreeObject` itself and unconditionally requires the `xnl-vfs-v2` marker
  and a valid lossless payload.
- Focused GREEN command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts revisioned-repository.test.ts`.
  Result: exit `0`; `2/2` files and `45/45` tests passed.
- Focused tree/revisioned regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts tree-conversion.test.ts tree-conversion-errors.test.ts revisioned-repository.test.ts revisioned-repository-apply.test.ts repository-commit-snapshot.test.ts`.
  Result: exit `0`; `6/6` files and `66/66` tests passed.
- Full VCS regression:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test`.
  Result: exit `0`; `24/24` files and `103/103` tests passed.
- VCS lint:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: exit `0` with `tsc --noEmit`.
- Strict Codument validation:
  `codument validate add-xnl-revisioned-persistence-primitives --strict`.
  Result: exit `0`;
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- P5-T2 is `DONE` with AC1/AC3 restored to checked. P5 remains `ACTIVE`; P6,
  package exports, dist artifacts, and git history were not touched. The hard
  XNL identity contract remains unchanged: `#id` is diff node identity and
  move alignment rather than an ordinary field update, and replacement is
  delete plus add.

## P6-T2 Package And Browser-Safe Verification Matrix

- Verification timestamp: `2026-07-31T03:55:44Z`.
- The parent had already completed the current-source VFS/VCS `tsup` builds.
  Per the leaf constraint, this independent verification did not rerun a
  dist-writing build. It inspected those generated artifacts and both tsup
  entry configurations directly.
- Full VFS regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs test`.
  Result: exit `0`; `20/20` files and `105/105` tests passed.
- Full VCS regression command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test`.
  Result: exit `0`; `24/24` files and `103/103` tests passed.
- Focused legacy compatibility command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs test lossless-tree-characterization.test.ts repository-commit-snapshot.test.ts -t legacy --reporter=verbose`.
  Result: exit `0`; `2/2` files, `8` passed and `31` skipped. The executed
  cases include markerless legacy tree fallback on the general reader,
  strict rejection on the lossless reader, detached-HEAD ordering before tree
  construction, and the legacy branch `Repository.commit` signature/build
  path.
- Typecheck/lint commands:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vfs lint` and
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/vcs lint`.
  Result: both exit `0` with `tsc --noEmit`.
- Package-map and artifact assertions found the exact mappings
  `xnl-vfs/revisioned-persistence -> {types: ./dist/revisioned-persistence.d.ts, import: ./dist/revisioned-persistence.js, require: ./dist/revisioned-persistence.cjs}`
  and
  `xnl-vcs/revisioned-repository -> {types: ./dist/revisioned-repository.d.ts, import: ./dist/revisioned-repository.js, require: ./dist/revisioned-repository.cjs}`.
  All eight generated `.js`, `.cjs`, `.d.ts`, and `.d.cts` files exist.
- Runtime package self-reference commands:
  `node --input-type=module -e "const m=await import('xnl-vfs/revisioned-persistence'); console.log(JSON.stringify({format:'esm',exports:Object.keys(m).sort()}))"`,
  `node -e "const m=require('xnl-vfs/revisioned-persistence'); console.log(JSON.stringify({format:'cjs',exports:Object.keys(m).sort()}))"`,
  `node --input-type=module -e "const m=await import('xnl-vcs/revisioned-repository'); console.log(JSON.stringify({format:'esm',exports:Object.keys(m).sort()}))"`,
  and
  `node -e "const m=require('xnl-vcs/revisioned-repository'); console.log(JSON.stringify({format:'cjs',exports:Object.keys(m).sort()}))"`.
  All four exited `0`; VFS ESM/CJS each exposed the same `3` symbols and VCS
  ESM/CJS each exposed `RevisionedRepositoryAdapter`.
- A read-only TypeScript `5.9.3` in-memory `CompilerHost` smoke compiled `.ts`
  ESM namespace imports and `.cts` `import = require(...)` imports for both
  package self-references with `NodeNext`, `strict`, and `noEmit`. All four
  cases had `0` diagnostics and resolved to the corresponding generated
  subpath `.d.ts`; no temporary source file was written.
- The recursive scan command was a read-only
  `node --input-type=module -e` TypeScript-AST traversal launched from
  `/Users/kongweixian/lang/xnl.ts/packages/vfs`. It extracted static imports,
  re-exports, dynamic imports, and `require()` calls; followed every relative
  edge; and mapped bare `xnl-core` to its package export for the matching ESM
  or CJS condition.
- ESM scan from `packages/vfs/dist/revisioned-persistence.js` reached exactly
  `3` files:
  `packages/vfs/dist/revisioned-persistence.js`,
  `packages/vfs/dist/chunk-4CN3DHOZ.js`, and
  `packages/core/dist/index.js`. Its edges were the relative re-export
  `./chunk-4CN3DHOZ.js` and that chunk's sole bare import, `xnl-core`.
- CJS scan from `packages/vfs/dist/revisioned-persistence.cjs` reached exactly
  `2` files:
  `packages/vfs/dist/revisioned-persistence.cjs` and
  `packages/core/dist/index.cjs`. Its sole edge and bare import was
  `require("xnl-core")`.
- Both graphs reported `0` missing reachable files, `0` `node:` imports, and
  `0` forbidden `fs`, `path`, or `crypto` imports, including their `node:`
  and subpath forms. This browser-safe verdict applies only to the explicit
  VFS revisioned-persistence subpath; no browser-safety claim is made for the
  VCS revisioned-repository subpath or either package root.
- Repository gate commands:
  `git diff --check` exited `0`;
  `codument validate add-xnl-revisioned-persistence-primitives --strict`
  exited `0` with
  `add-xnl-revisioned-persistence-primitives: track.xml OK + 1 behavior delta(s)`.
- P6-T2 is `DONE` with AC1/AC2 checked. P6 remains `ACTIVE` for parent-owned
  phase hooks. No implementation or build artifact was changed and no commit
  was created. The hard XNL identity contract remains unchanged: `#id` is
  diff identity and move alignment, not an ordinary update field; identity
  replacement is delete plus add.
