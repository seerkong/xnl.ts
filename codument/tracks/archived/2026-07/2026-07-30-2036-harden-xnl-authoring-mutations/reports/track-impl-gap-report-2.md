# Gap Loop Report 2 - harden-xnl-authoring-mutations / P3

## Scope

- Track: `harden-xnl-authoring-mutations`
- Scope: phase `P3`
- Round: `2`
- Role: freshly created round executor
- Verdict: `NO_GAP`

## Inputs Read

- `proposal.md`
- `design.md`
- `decisions.xnl`
- `behavior_deltas/xnl-mutation-transaction/delta.xml`
- `track.xml`
- Historical report: `reports/track-impl-gap-report-1.md`
- Track analysis files under `analysis/`
- Current implementation and uncommitted diff under `packages/core/src`,
  `packages/core/tests`, `packages/core/README.md`, and generated
  `packages/core/dist`

## Target Comparison

P3 requires the strict authoring mutation API to be publicly exported, documented,
validated by the core package matrix, and available from the package build surface
without weakening the full Track identity semantics.

The current implementation satisfies the P3 public surface:

- `packages/core/src/index.ts` exports `dryRunMutations` and all strict batch
  contract types from the package root.
- `XNL.mutation.dryRun` and `XNL.mutation.preview` delegate to the strict
  dry-run API.
- Generated ESM, CJS, and declaration outputs expose the same API.
- `packages/core/README.md` documents the preview API, atomic rejection shape,
  `identityPolicy`, `verifyValueBefore`, and the rule that element `#id` is an
  identity key rather than an ordinary payload field.

The broader Track semantics were independently rechecked:

- `#id` is still used for diff alignment, move detection, and identity-targeted
  addressing, not emitted as an ordinary update.
- Strict dry-run rejects hand-authored element `:id` add/update/delete
  mutations with `IDENTITY_MUTATION_FORBIDDEN`.
- Identity replacement remains expressible as delete plus add.
- Legacy `applyMutations` remains the mutable compatibility primitive.
- Duplicate identity, configurable missing identity, stale `valueBefore`,
  failed apply isolation, result identity rejection, tag update, mixed payload,
  and full diff/apply parity coverage are present in tests.

## Adversarial Probes

I ran additional probes aimed at likely first-round blind spots:

- body-to-extend move
- extend-to-body move
- nested cross-level body move with tag and payload changes
- extend child tag plus payload change
- body-to-extend move with tag plus payload change

All probes produced applied strict previews and legacy apply results equal to the
target under the package's AST comparison semantics, and none emitted an element
`:id` payload mutation. A stricter raw object comparison initially flagged
differences from optional `undefined` fields and object key insertion order; that
does not indicate an XNL AST parity gap under the existing package comparator or
serialization semantics.

## Verification

- `bun run --cwd packages/core test` passed: 14 files, 113 tests.
- `bun run --cwd packages/core lint` passed.
- `bun run --cwd packages/core build` passed.
- `git diff --check` passed.
- `bun x codument validate harden-xnl-authoring-mutations --strict` passed.
- Generated ESM and CJS smoke imports confirmed root `dryRunMutations` and
  `XNL.mutation.preview` are callable and reject direct `:id` mutation.
- Browser bundle probe with esbuild `--platform=browser` completed without
  unresolved Node builtin imports.
- Source/dist import scan found no runtime Node builtin imports in the core
  package build surface.

## Gaps

No P3 or wider Track gap was found in this round.
