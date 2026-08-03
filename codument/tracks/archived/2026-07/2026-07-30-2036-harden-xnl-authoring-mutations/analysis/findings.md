# Findings

## Found Facts

- `diffArray` reads effective identity from node `#id` first and legacy
  `metadata.id` second, then uses it for move reconciliation.
- In identity mode, differing sibling identities are represented as delete/add;
  `#id` is not diffed as an ordinary field.
- `applyMutations` applies the batch sequentially to the supplied root.
- `XnlMutation.valueBefore` exists but is not checked by apply.
- The current cross-level parity test does not assert the applied AST.
- DataElement/TextElement diff does not currently emit tag changes.
- A caller can currently construct a direct element `:id` mutation; legacy
  apply does not reject that path.

## Constraints

- Preserve `#id` as identity key; do not add an ID update mutation.
- The new strict batch API must reject direct element ID field mutation while
  preserving legacy apply compatibility.
- Preserve the published mutable API and add an explicit strict API.
- Generic XNL must continue to support elements without identity.
- No VFS/VCS or application-specific authoring policy in this Track.

## Open Questions

- Final public API names may be refined during type-first implementation, while
  the result semantics in design.md remain fixed.
- DataElement/TextElement kind replacement remains outside tag update and must
  either be explicit delete/add or a clear unsupported diagnostic.

## Conclusions

- A clone-based batch result and identity validator belong in xnl-core.
- Move parity requires full AST assertions, not mutation-shape assertions.

## Parent Spot-check P1-T1

- Independently reran the 19-test characterization file: 2 passed and 17
  failed for the intended missing strict API, move parity, and tag-diff gaps.
- Independently reran the 11 existing mutation tests: all passed.
- `bun run --cwd packages/core lint` passed.
- Diff review confirmed the task only added tests and its own Codument evidence;
  it did not implement production behavior or update `#id` as payload.

## Parent Spot-check P1-T2

- Reviewed the contract in `packages/core/src/mutation/index.ts`: it is
  renderer-neutral, readonly at the batch boundary, discriminated by status,
  and contains all six planned diagnostic codes plus path/index/identity data.
- Confirmed runtime exports still contain only the legacy mutation functions;
  P1-T2 did not smuggle in a partial implementation.
- Independently reran lint and 11 existing mutation tests: all passed.
- Characterization remains intentionally red at 2 passed / 17 failed, with the
  same implementation, move-parity, and tag-diff causes.

## Parent Spot-check P2-T1

- Reviewed `dryRunMutations`: it clones base and batch, validates identities
  across all reachable containers, rejects direct element `:id`, checks
  `valueBefore`, and delegates actual mutation execution to `applySingle`.
- Rejection always returns the untouched base clone; partial candidate state is
  not exposed.
- Independently reran the full characterization: 19 passed and only the six
  deferred move/tag cases failed.
- Independently reran 11 legacy mutation tests and TypeScript lint: all passed.
- Diff review confirmed `applyMutations` remained unchanged and no `#id`
  payload update path was added.

## Parent Spot-check P2-T2 Gap

- Independently reran the 29 focused mutation/parity tests and the full
  94-test core suite; all planned move/tag cases passed and lint was clean.
- Additional complete-AST probes found the same optional-container parity class
  beyond `body`: removing the final attribute left `attributes: {}` when the
  target omitted `attributes`; removing the final extend child left an empty
  `extend` object when the target omitted `extend`.
- Because the behavior requires complete AST parity, P2-T2 was reopened. The
  repair must cover DataElement and TextElement attributes plus DataElement
  extend absent/empty transitions without weakening the identity/move fixes.

## Parent Spot-check P2-T2 Corrective Pass

- Reviewed the optional-attribute and optional-extend mutation generation:
  absent, explicit empty, and populated states now have explicit transitions.
- Independently reran all 113 core tests, TypeScript lint, and diff check:
  all passed.
- Independently reran eight forward/reverse attribute and extend probes through
  both legacy apply and strict dry-run; semantic AST parity passed. Parser-owned
  optional `undefined` keys and deleted optional keys serialize identically and
  are intentionally equal under the package test comparator.
- Diff review confirmed the corrective pass preserved move ordering, moved-node
  payload updates, strict identity checks, and the absence of ordinary `#id`
  mutation.

## Parent Spot-check P3-T1

- Independently reran 113 core tests, TypeScript lint, package build, and diff
  check: all passed.
- Loaded both generated ESM and CJS outputs and confirmed root
  `dryRunMutations` plus `XNL.mutation.dryRun/preview` are callable.
- Verified generated declaration files contain the strict batch result,
  diagnostics, and function exports.
- Browser-entry scan found no `node:*` import in core source or generated
  runtime bundles.
- Reviewed README guidance and public facade: legacy apply/diff remain present,
  and the docs explicitly preserve `#id` as identity rather than payload.

## P1-T1 Evidence (2026-07-30)

- Added `packages/core/tests/mutation-authoring-characterization.test.ts` with
  executable, non-skipped characterization for identity replacement/move
  semantics, duplicate and missing identity policies, direct element `:id`
  rejection, immutable atomic preview, stale update/delete/move
  `valueBefore`, complete move/mixed AST parity, and DataElement/TextElement tag
  updates.
- Existing mutation baseline remained green before the new red suite:
  `bun run test -- tests/mutation.test.ts tests/mutation-parity.test.ts` passed
  11/11 tests.
- `bun run lint` passed (`tsc --noEmit`), so the new red state is behavioral
  rather than a TypeScript or test-loading failure.
- Focused command
  `bun run test -- tests/mutation-authoring-characterization.test.ts` exited 1
  with 19 tests: 2 passed and 17 failed as expected.
- Eleven strict-batch cases fail with the exact current cause
  `Expected mutation module to export strict dryRunMutations`; these cases lock
  duplicate/missing identity, immutable success/rejection, direct `:id`
  add/update/delete rejection, and stale update/delete/move preconditions.
- Four complete-AST parity cases expose current apply/diff gaps: a simple
  cross-parent move leaves `body: []` where the target has no body; same-level
  reorder target `d,c,a,b` applies as `d,a,c,b`; cross-parent target sibling
  order `a,d,b` applies as `a,b,d`; and mixed moved nodes retain stale
  `score`, `flag`, and tag values.
- Both DataElement and TextElement tag cases fail because `diffNodes` returns
  no `:tag` mutation. The passing cases prove current identity replacement is
  delete/add with no ordinary `:id` update and that a three-node rotation can
  already reach full AST parity.
- No production API or implementation was added in P1-T1; the focused suite is
  intentionally red for P1-T2/P2 implementation work.

## P1-T2 Evidence (2026-07-30)

- Added exported, type-only mutation-module contracts for the readonly ordered
  batch, strict options, callable dry-run shape, discriminated applied/rejected
  result, identity policy, and diagnostics. No runtime `dryRunMutations` export
  or behavior was introduced.
- `XnlMutationDiagnosticCode` fixes the six designed codes:
  `DUPLICATE_IDENTITY`, `MISSING_IDENTITY`,
  `IDENTITY_MUTATION_FORBIDDEN`, `PRECONDITION_FAILED`, `APPLY_FAILED`, and
  `RESULT_IDENTITY_INVALID`. Diagnostics can identify the zero-based mutation
  position, path, and effective identity when available.
- `XnlMutationBatchOptions` retains existing mutation options, exposes
  `verifyValueBefore`, and documents `allow-missing` as the default
  `identityPolicy` while making `require-elements` the opt-in strict policy.
- The applied branch fixes diagnostics to a readonly empty tuple. The rejected
  branch exposes diagnostics and documents `value` as an isolated clone of the
  unchanged base, never partially applied authority.
- Replaced all characterization-local batch/result/diagnostic/callable types
  with type imports from `packages/core/src/mutation/index.ts`; `bun run lint`
  passed, proving the red suite now type-checks against the production contract.
- Existing compatibility baseline remained green:
  `bun run test -- tests/mutation.test.ts tests/mutation-parity.test.ts` passed
  11/11 tests.
- Focused characterization remained intentionally red:
  `bun run test -- tests/mutation-authoring-characterization.test.ts` exited 1
  with 2 passed and 17 failed. Eleven strict-batch cases still fail with
  `Expected mutation module to export strict dryRunMutations`; the other six
  retain the pre-existing move/parity/tag behavior gaps assigned to P2.
- Diff review confirmed the existing `diffNodes` and `applyMutations`
  signatures and runtime bodies are unchanged, `packages/core/src/index.ts`
  is untouched, and no identity validation, batch apply, tag, or move fix was
  implemented.

## P2-T1 Evidence (2026-07-30)

- Exported `dryRunMutations` from the mutation module with an explicit
  `XnlDryRunMutations` assignment. The package root export remains untouched
  for P3-T1.
- The strict path clones the base for rejection authority, clones that value
  again for candidate apply, and clones the ordered mutation batch before
  calling the existing `applySingle`. A same-batch add-then-update test proves
  later apply cannot mutate the caller's `valueAfter` object.
- Identity validation walks every recursively reachable object/array branch,
  prefers element `#id` over legacy `metadata.id`, always rejects duplicate
  effective identities, and applies missing-identity checks only under
  `require-elements`. Tests include an element nested outside `body`.
- Base identity failures retain `DUPLICATE_IDENTITY` or `MISSING_IDENTITY`;
  invalid post-apply identity states are hidden and reported as
  `RESULT_IDENTITY_INVALID`.
- Strict add/update/delete checks resolve the target's parent before apply and
  reject a direct element `:id` path with `IDENTITY_MUTATION_FORBIDDEN`.
  Legacy `applyMutations` was not changed, and identity replacement remains
  represented by delete/add.
- With `verifyValueBefore`, update/delete inspect the current mutation path and
  move first inspects the identity-selected node, matching `applySingle`
  targeting semantics. Comparison is recursive structural equality; stale
  values return `PRECONDITION_FAILED`.
- Apply/path exceptions return `APPLY_FAILED` with mutation index/path when
  available. Every rejection returns the untouched rejection clone, never the
  partially applied candidate.
- Focused strict command passed 17/17 selected tests (8 unrelated tests
  skipped). The complete characterization file now reports 19 passed and 6
  failed; the remaining failures are exactly the deferred P2-T2 cases:
  cross-parent empty-body parity, same-level reorder, multi-cross-parent order,
  mixed moved-node payload/tag parity, and the two tag-diff cases.
- Compatibility verification passed all 11 existing mutation tests:
  `bun run test -- tests/mutation.test.ts tests/mutation-parity.test.ts`.
  `bun run lint` (`tsc --noEmit`) and `git diff --check` also passed.

## P2-T2 Evidence (2026-07-30)

- Reproduced the focused characterization before implementation at 19 passed /
  6 failed and inspected every red mutation sequence. The empty-body move was
  one `moving: left[0] -> right[0]` cross-level move; the four-node reorder was
  `a:0->2, b:1->3, c:2->1, d:3->0`; the multi-parent case was
  `a:left[0]->right[0], b:left[1]->right[2], c:right[0]->left[0]`.
- The mixed red sequence contained moves for `a`, `b`, and `retag`, followed by
  mode/text update plus `remove` delete and `add` add. It contained no score,
  flag, or tag update for the moved snapshots. DataElement and TextElement tag
  cases each produced an empty mutation sequence.
- Same-kind DataElement/TextElement tag changes now emit a `TREE_UPDATE` on
  `:tag` with old/new values. Identity-mode metadata filtering remains intact,
  and all parity tests assert that no ordinary element `:id` mutation exists.
- `reconcileMoves` now pairs only same-kind element delete/add snapshots,
  preserves them on the move, and recursively diffs source versus target at a
  stable `#id` path. Moved payload changes therefore become ordinary
  identity-anchored updates such as `#b:attributes::'score'` and
  `#retag:tag`; different-kind or different-identity replacement stays
  delete/add.
- Ordered apply now removes true deletes in descending sibling order, then
  executes moves/adds in ascending target-index order, and applies payload
  changes after structure settles. When an identity sequence changes, every
  retained identity is emitted as a target-position anchor, including a sibling
  whose old/new numeric index happens to be equal.
- Body presence is reconciled explicitly: moving the final child to a target
  with absent body adds a trailing body delete, while a target with explicit
  empty body retains `[]`. No cleanup heuristic collapses those two AST states.
- `dryRunMutations` was not given a target snapshot or alternate apply path; it
  still clones inputs and delegates each ordered mutation to the existing
  `applySingle` engine.
- Strengthened the legacy parity fixture to assert both mutable apply and strict
  dry-run full AST equality. Characterization now includes explicit empty-body,
  unchanged-index sibling, moved score, moved flag, and moved tag assertions.
- Deterministic probes passed 240 reorder/cross-parent/empty-vs-absent
  combinations, 1,631 combinations including real add/delete, and 120
  permutation cases with `verifyValueBefore` enabled.
- Parent spot-check passed all 38 mutation tests (27 characterization + 11
  legacy), then the complete core suite passed 94/94 tests across 14 files.
  `bun run --cwd packages/core lint` and `git diff --check` also passed.
- Diff review confirmed `packages/core/src/index.ts` and all P3 task state remain
  untouched.

## P2-T2 Corrective Evidence (2026-07-30)

- Fresh baseline verification passed the existing 94/94 core tests before the
  corrective test additions.
- Added 19 full-AST regression cases covering all directed
  absent/explicit-empty/populated attribute transitions for DataElement and
  TextElement, all corresponding DataElement extend transitions, and a
  cross-parent move that removes the emptied source extend while preserving a
  moved payload update.
- The required red run reported 35 passed / 11 failed. It reproduced all three
  parent spot-check gaps, their empty/absent reverse transitions, the same
  attribute failures on TextElement, and TextElement absent-to-populated apply
  failure.
- Attribute presence changes now add or delete the whole optional container;
  when both containers exist, the existing granular map diff remains in use.
  This also avoids relying on path auto-creation for TextElement attributes.
- Extend child/order diffs remain unchanged so identity-based move pairing still
  sees child snapshots. A final identity-anchored container add/delete preserves
  explicit-empty versus absent extend state after structural mutations settle.
- The focused characterization passed 46/46, and the three mutation suites
  passed 57/57. All 18 directed optional-container transitions also passed a
  strict dry-run probe with `verifyValueBefore: true`, full AST equality, and no
  mutation targeting element `:id`.
- Final verification passed the complete core suite at 113/113 tests across 14
  files, `bun run --cwd packages/core lint`, and `git diff --check`.
- Diff review confirmed existing tag/move ordering and moved payload updates
  remain present, `#id` remains identity-only, and `packages/core/src/index.ts`
  plus P3/root track state remain untouched.

## P3-T1 Evidence (2026-07-30)

- `packages/core/src/index.ts` now exports `dryRunMutations` and the public
  `XnlMutationBatch`, `XnlMutationIdentityPolicy`,
  `XnlMutationDiagnosticCode`, `XnlMutationDiagnostic`,
  `XnlMutationBatchOptions`, `XnlMutationBatchResult`, and
  `XnlDryRunMutations` contracts from the package root.
- `XNL.mutation.apply` and `XNL.mutation.diff` remain unchanged.
  `XNL.mutation.dryRun` and `XNL.mutation.preview` are aliases of the same
  strict `dryRunMutations` function.
- `packages/core/README.md` documents the strict preview flow, `#id` as a
  diff/move identity key rather than ordinary update payload, direct `:id`
  rejection, delete/add identity replacement, default `allow-missing` versus
  opt-in `require-elements`, `valueBefore` preconditions, and rejection
  authority that never exposes a partially applied candidate.
- Full package verification passed: 113/113 tests across 14 files,
  `bun run --cwd packages/core lint`, and
  `bun run --cwd packages/core build`.
- The generated ESM and CJS packages both exposed `dryRunMutations`,
  preserved `applyMutations`/`diffNodes`, and exposed facade
  `apply`/`diff`/`dryRun`/`preview`; both declaration outputs contained every
  public strict batch, options, result, diagnostic, identity-policy, and
  callable type. Generated `dist` files were restored after verification
  because they are outside P3-T1's allowed persisted change surface.
- The identity residue scan found no `ip("id")`, literal `:id` mutation path,
  or equivalent element-ID update generator in the production mutation
  module. Its only relevant hits were the strict direct-ID rejection and the
  existing identity-mode `metadata.id` safeguards.
- Every source import/export specifier in the core browser entry graph is
  relative. The freshly built ESM/CJS bundles contained no `node:` import,
  `require(...)`, `process`, or `__dirname` residue.
- `git diff --check` and
  `codument validate harden-xnl-authoring-mutations --strict` passed. Diff
  review confirmed P3-T1 did not modify accepted mutation runtime semantics or
  tests.
- P3-T1 and P3 are DONE with all acceptance criteria checked. Track Metadata
  intentionally remains `in_progress` for the parent-owned final gap-loop.
