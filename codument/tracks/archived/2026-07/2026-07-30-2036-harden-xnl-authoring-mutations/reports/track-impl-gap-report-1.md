# Gap Loop Report 1 - harden-xnl-authoring-mutations / P3

## Scope

- Track: `harden-xnl-authoring-mutations`
- Scope: phase `P3`
- Round: `1`
- Role: freshly created round executor
- Verdict: `NO_GAP`

## Inputs Read

- `proposal.md`
- `design.md`
- `decisions.xnl`
- `behavior_deltas/xnl-mutation-transaction/delta.xml`
- `track.xml`
- Historical reports: none present before this report
- Current implementation and uncommitted diff under `packages/core/src`,
  `packages/core/tests`, `packages/core/README.md`, and generated
  `packages/core/dist`

## Target Comparison

P3 requires public API export, documentation, full core validation, build, and a
residue scan confirming `#id` remains an identity key rather than an ordinary
payload field.

The current implementation exports `dryRunMutations` and strict batch contracts
from `packages/core/src/index.ts`, exposes `XNL.mutation.dryRun` and
`XNL.mutation.preview`, documents mutation preview semantics in
`packages/core/README.md`, and the built `dist` artifacts contain the same public
surface.

Strict identity semantics match the accepted decisions:

- `diffNodes` does not emit ordinary element `:id` updates for identity changes.
- Move detection uses effective identity via `targetUniqueName` and parent
  identity metadata.
- Strict batch rejects direct element `:id` add/update/delete mutations with
  `IDENTITY_MUTATION_FORBIDDEN`.
- Identity replacement is represented by delete plus add, not an in-place
  identity mutation.
- Legacy `applyMutations` remains mutable and source-compatible.

The wider Track acceptance is also covered: clone-based dry run, structured
diagnostics, configurable missing identity policy, duplicate identity rejection,
`valueBefore` preconditions, tag updates, move parity, failed-batch isolation,
and complete AST parity tests are present.

## Verification

- `bun run --cwd packages/core test` passed: 14 files, 113 tests.
- `bun run --cwd packages/core lint` passed.
- `bun run --cwd packages/core build` passed.
- `bun x codument validate harden-xnl-authoring-mutations --strict` passed.
- Dist smoke import passed, including strict rejection of `#item:id` mutation
  through `XNL.mutation.preview`.
- Residue scan of source, tests, README, and dist found the expected `#id`
  touchpoints and no gap against the P3 acceptance criteria.

## Gaps

No implementation, design, behavior, or track gap was found for P3 or the Track
acceptance surface in this round.
