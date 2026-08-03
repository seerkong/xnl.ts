# Track Implementation Gap Report 1

Track: `reject-xnl-identity-replacement-bypass`
Scope: phase `P2`
Protocol: `cdt:GapLoop`
Round: `1`
Generated: `2026-07-30T19:56:54Z`
Fresh executor: yes

## Verdict

NO_GAP.

No implementation, behavior, design, or track target gap was found for the P2
acceptance criteria. Per fresh-subagent protocol, no implementation files were
changed.

## Required Inputs Read

- `proposal.md`
- `design.md`
- `behavior_deltas/xnl-mutation-transaction/delta.xml`
- `track.xml`
- `decisions.xnl`
- `analysis/findings.md`
- `analysis/knowledge.md`
- Existing `reports/`: no prior reports directory or historical report existed
  before this round.
- Current implementation and uncommitted diff:
  - `packages/core/src/mutation/index.ts`
  - `packages/core/src/path/index.ts`
  - `packages/core/src/index.ts`
  - `packages/core/tests/mutation-authoring-characterization.test.ts`
  - `packages/core/tests/mutation-parity.test.ts`
  - `packages/core/README.md`
  - `packages/core/dist/index.{js,cjs,d.ts,d.cts}` and source maps

## Target Alignment Review

### Hard semantic: `#id` alignment, not payload

The current implementation keeps `#id` as an identity key for diff alignment,
move detection, and target addressing:

- `diffNodes`/`diffDataElement`/`diffTextElement` do not emit ordinary `:id`
  payload updates under identity mode.
- Direct element id add/update/delete is rejected by strict dry-run with
  `IDENTITY_MUTATION_FORBIDDEN`.
- README documents that `#id` is not ordinary mutation payload.
- Focus and dist residue tests confirmed identity replacement diff emits
  `TREE_DELETE` plus `TREE_ADD`, not an ordinary id update.

### Strict identity continuity

P2 requires update mutations to preserve an ordered full-tree identity skeleton,
including identity value and authority source. The implementation satisfies
this by:

- collecting full-tree ordered skeleton entries before and after
  `TREE_UPDATE`/`OBJECT_UPDATE`;
- recording descriptor authority as `explicit-id` or `metadata-fallback`;
- rejecting add/remove/swap/relocate and explicit-id/fallback transitions with
  `IDENTITY_MUTATION_FORBIDDEN`;
- returning an unchanged base clone on rejection.

The direct metadata fallback id guard is present and preserves explicit `#id`
compatibility behavior.

### Extend move, retag, and coherence

The implementation satisfies the Extend requirements:

- `diffExtend` emits explicit `TREE_MOVE_SAME_LEVEL` mutations for identified
  and missing-id reorder cases instead of `TREE_UPDATE ...:extend:order`.
- Missing-id reorder uses current `pathBefore` after simulated lower-index
  additions/deletions.
- Same-identity retag emits a structural move with `destinationKey`, followed
  by the ordinary tag/payload update.
- Cross-parent retag reconciliation propagates `destinationKey` from the paired
  add side.
- Strict dry-run performs batch-final Extend order/key/tag coherence validation
  and returns `RESULT_STRUCTURE_INVALID` for incoherent final structures.
- Occupied Extend keyed insertion/move destinations are rejected when they
  would overwrite another identified child, while same-source reorder and
  delete-then-add replacement remain valid.

### Legacy compatibility

Legacy `applyMutations` remains source-compatible:

- Existing signatures are unchanged.
- `destinationKey` is optional.
- Legacy apply behavior remains available separately from strict
  `dryRunMutations`.
- The characterization suite includes legacy compatibility coverage for the
  former hidden replacement mutation.

### Public build and docs

The public surface is aligned:

- `dryRunMutations` and related batch/diagnostic types are exported from
  `src/index.ts` and generated `dist` declarations.
- `XNL.mutation.dryRun` and `XNL.mutation.preview` facade aliases are present.
- Generated ESM/CJS entrypoints expose `dryRunMutations` and `diffNodes`.
- README documents strict identity continuity,
  `IDENTITY_MUTATION_FORBIDDEN`, `RESULT_STRUCTURE_INVALID`, `destinationKey`,
  and the fact that `#id` remains alignment/move identity rather than payload.

## Uncommitted Diff Review

The uncommitted diff contains the expected P2 implementation, tests, docs, and
generated package outputs. It also includes existing Codument/project files and
track directories outside the P2 source files; those were read as context where
relevant and not modified by this round except for adding this report.

Observed diff stat before this report:

- `packages/core/src/mutation/index.ts`: strict dry-run diagnostics,
  skeleton validation, destination guard, Extend coherence, Extend diff and
  move reconciliation changes.
- `packages/core/src/path/index.ts`: optional `destinationKey` support for
  Extend path writes.
- `packages/core/src/index.ts`: public exports and facade aliases.
- `packages/core/tests/mutation-authoring-characterization.test.ts`: untracked
  characterization matrix covering identity replacement, metadata fallback,
  authority transitions, occupied destinations, Extend reorder/retag/coherence,
  permutation parity, legacy compatibility, and atomic rejection behavior.
- `packages/core/tests/mutation-parity.test.ts`: parity now verifies apply and
  strict dry-run.
- `packages/core/README.md`: Mutation preview documentation.
- `packages/core/dist/`: regenerated build output.

## Verification

Commands run in `/Users/kongweixian/lang/xnl.ts`:

- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
  - Passed: 1 file, 159 tests.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-parity.test.ts`
  - Passed: 1 file, 2 tests.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core lint`
  - Passed: `tsc --noEmit`.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test`
  - Passed: 14 files, 226 tests.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core build`
  - Passed: ESM, CJS, declarations, and source maps generated.
- ESM smoke import:
  - Passed: `dryRunMutations` and `diffNodes` are functions from
    `packages/core/dist/index.js`.
- CJS smoke import:
  - Passed: `dryRunMutations` and `diffNodes` are functions from
    `packages/core/dist/index.cjs`.
- Public type/export scan:
  - Passed for `destinationKey?: string`, `RESULT_STRUCTURE_INVALID`,
    `diagnostics: readonly XnlMutationDiagnostic[]`, `dryRunMutations`, and
    `diffNodes` across source and generated declaration files.
- Focus residue tests:
  - Passed: 95 matching tests for identity replacement, direct id update,
    Extend reorder, Extend permutation, `destinationKey`, and
    `RESULT_STRUCTURE_INVALID`.
- Dist residue smoke:
  - Passed: identity replacement emitted only `TREE_DELETE`/`TREE_ADD`;
    identified Extend reorder, missing-id Extend reorder, and same-identity
    Extend retag emitted moves, emitted no `TREE_UPDATE ...:extend:order`, and
    strict dry-run applied exactly to the target.

Note: one ad hoc dist smoke attempt used `JSON.stringify` for equality and was
discarded because object key insertion order is not a semantic AST difference;
the same scenarios passed with `assert.deepStrictEqual`.

## Result

P2 ACs are satisfied:

- `P2-T1-AC1`: satisfied.
- `P2-T1-AC2`: satisfied.
- `P2-T1-AC3`: satisfied.
- `P2-T1-AC4`: satisfied.
- `P2-T2-AC1`: satisfied.
- `P2-T2-AC2`: satisfied.
- `P2-T2-AC3`: satisfied.
- `P2-T2-AC4`: satisfied.

Round status: `NO_GAP`.
