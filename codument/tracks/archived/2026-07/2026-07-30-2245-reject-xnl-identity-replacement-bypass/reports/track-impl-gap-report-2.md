# Track Implementation Gap Report 2

Track: `reject-xnl-identity-replacement-bypass`
Scope: phase `P2`
Protocol: `cdt:GapLoop`
Round: `2`
Generated: `2026-07-30T20:04:01Z`
Fresh executor: yes

## Verdict

NO_GAP.

This round performed an independent adversarial recheck of the P2 target and
the round 1 conclusion. No implementation, behavior delta, design, or track
acceptance gap was found. No implementation files were changed by this round.

## Inputs Read

- `proposal.md`
- `design.md`
- `behavior_deltas/xnl-mutation-transaction/delta.xml`
- `track.xml`
- `decisions.xnl`
- `analysis/findings.md`
- `analysis/knowledge.md`
- `reports/track-impl-gap-report-1.md`
- Current implementation, tests, README, generated dist output, and uncommitted
  diff for the P2 files.

## Adversarial Recheck

### Hidden identity replacement

Strict dry-run compares the ordered full-tree identity skeleton around
`TREE_UPDATE` and `OBJECT_UPDATE`, including identity value and authority
source. I rechecked whole-node replacement, body container add/swap, attributes
container replacement, Extend order container updates, metadata fallback map
replacement, direct fallback id add/update/delete, and same-value authority
transitions between explicit `#id` and metadata fallback. These cases reject
with `IDENTITY_MUTATION_FORBIDDEN` and return an unchanged base clone.

### `#id` alignment, not payload

`diffNodes` still treats `#id` as the alignment and move key, not ordinary
payload. Identity replacement diffs emit explicit `TREE_DELETE` plus
`TREE_ADD`; cross-parent moves use move mutations; no checked diff residue
emitted a `:id` update. Direct element id mutations remain rejected by strict
dry-run.

### Destination overwrite

Assignment-style `OBJECT_ADD`/`TREE_ADD` and moves reject occupied identified
destinations before exposing partial state. I rechecked body property overwrite,
attribute/map overwrite, Extend keyed overwrite, Extend index collision by
value tag, and Extend move collision via `destinationKey`. Ordinary array
insertion, empty Extend insertion, same-source Extend reorder, and delete-then-
add replacement remain accepted.

### Extend parity, retag, and coherence

I rechecked Extend reorder and retag behavior beyond the durable 72-case test
matrix with an exhaustive 8,450-pair smoke over every old/target permutation of
every subset of four child tags, in both identified and missing-identity modes.
Every pair satisfied `diffNodes -> dryRunMutations -> target`, and no mutation
set contained `TREE_UPDATE ...:extend:order`.

Same-identity retag with and without reorder emits a structural move carrying
`destinationKey` plus a later ordinary tag update. Same-index retag and both
index directions pass strict apply. Standalone retag without key migration is
rejected with `RESULT_STRUCTURE_INVALID`, preserving the intended distinction
between identity continuity failures and final Extend storage incoherence.

### Legacy and public build

Legacy `applyMutations` remains compatible for explicit structural mutation
sets and for the documented direct metadata-id compatibility boundary. The
public source and generated declarations expose `dryRunMutations`,
`XNL.mutation.dryRun`, `XNL.mutation.preview`, `destinationKey`,
`RESULT_STRUCTURE_INVALID`, and the batch diagnostic types. ESM and CJS dist
imports both expose callable `dryRunMutations`, `diffNodes`, and facade aliases.

## Verification

Commands run in `/Users/kongweixian/lang/xnl.ts`:

- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
  - Passed: 1 file, 159 tests.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-parity.test.ts`
  - Passed: 1 file, 2 tests.
- Adversarial stdin smoke with hidden identity, destination overwrite,
  Extend retag/coherence, and exhaustive Extend permutation checks.
  - Passed: `{"adversarial":"pass","extendPairs":8450}`.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test`
  - Passed: 14 files, 226 tests.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core lint`
  - Passed: `tsc --noEmit`.
- `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core build`
  - Passed: ESM, CJS, declarations, and source maps generated.
- `codument validate reject-xnl-identity-replacement-bypass --strict`
  - Passed: `track.xml OK + 1 behavior delta(s)`.
- ESM/CJS public import smoke.
  - Passed: `dryRunMutations`, `diffNodes`, and `XNL.mutation.preview` are
    callable from both `dist/index.js` and `dist/index.cjs`.
- Public residue scan.
  - Passed for `destinationKey?: string`, `RESULT_STRUCTURE_INVALID`,
    `diagnostics: readonly XnlMutationDiagnostic[]`, `dryRunMutations`,
    `diffNodes`, and facade aliases across source and generated outputs.
- `git diff --check`
  - Passed with no whitespace errors.

## Result

Round 1's `NO_GAP` conclusion survives independent adversarial review for
phase `P2`.

Round status: `NO_GAP`.
