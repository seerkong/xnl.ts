# Findings

## Found Facts

- Direct element ID paths are rejected by strict dry-run.
- `TREE_UPDATE "#root:body::0"` can replace metadata id `old` with `new` and
  currently returns `applied` under `require-elements`.
- Result-level duplicate/missing validation does not detect identity continuity
  violations when the final identities are otherwise valid.

## Constraints

- `#id` remains the diff alignment key and is not an ordinary compared field.
- Legacy apply remains compatible.
- Explicit delete/add/move must remain available.
- Rejected batches return an unchanged base clone.

## Open Questions

- None.

## Conclusions

- Add a per-update full-tree identity-skeleton invariant to strict dry-run;
  compare relative structural paths, not only the target subtree or identity
  set.
- Guard assignment-style add/move destinations against overwriting an existing
  identified subtree.

## Fresh AttractorCheck

- Target-only skeleton misses metadata-container updates that change the parent
  element fallback identity.
- Add and move reuse assignment for properties/maps and can overwrite an
  occupied identity unless strict validates the destination.
- The test matrix must cover Data/TextElement, metadata fallback, explicit
  `#id` precedence, body/attributes/extend, both identity policies, and legacy
  compatibility.

## Fresh AttractorCheck 2

- Extend is not an ordinary map or array: `order` is authoritative for child
  position while `children[tag]` owns the child. A skeleton that only traverses
  `children` cannot observe reorder.
- Existing `diffExtend` emits `TREE_UPDATE` for `extend.order`; an ordered
  identity invariant would correctly reject that update, so diff must emit
  explicit same-level moves for identified child reorder.
- Extend `ListIndex` insertion also assigns `children[value.tag]`; it must not
  inherit the unconditional-safe rule for ordinary array insertion.
- Identity continuity must preserve both the effective string and its raw
  authority source. Switching between explicit `#id` and metadata fallback is
  an identity-authority mutation even when the string is unchanged.
- Required tests include same-tag Extend add, cross-parent occupied move,
  same-source reorder, delete-then-add replacement, and strict diff/apply
  parity.

## Fresh AttractorCheck 3

- Direct `metadata::id` mutation was not closed by the element `:id` guard.
  Under strict identity mode it must be rejected when metadata id is the
  element's effective fallback authority; an explicit `#id` keeps the existing
  metadata-id compatibility behavior.
- Extend index collision is determined by `children[value.tag]`, not by the
  sibling currently occupying the insertion index. The latter must be allowed
  to shift during a legal reorder.
- Final residue verification must explicitly prohibit
  `TREE_UPDATE ...:extend:order` for identified Extend reorder.

## Fresh AttractorCheck 4

- Extend order is structural for every child. Under `allow-missing`, an
  unidentified child reorder must use a pathBefore move rather than falling
  back to an order-array update.
- Extend storage is tag-keyed. A same-identity retag must migrate the children
  key and order entry before/with the tag update.
- Strict batch-final validation must reject incoherent Extend bodies while
  allowing the temporary move-then-retag intermediate state inside one atomic
  batch.

## Fresh AttractorCheck 5

- Existing Extend index insertion derives the storage key from the moved
  object's old tag, so it cannot carry retag plus target order by itself.
- Add optional mutation `destinationKey` as structural move metadata. Apply
  uses it for the Extend children key and target index while later update
  changes the child tag.
- Characterization must cover retag+reorder in both index directions; a MapKey
  append-only workaround is insufficient.

## P1-T1 Test Evidence

- Added strict characterization tests in
  `packages/core/tests/mutation-authoring-characterization.test.ts` only; no
  production, README, or dist files were edited.
- Target command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`.
- Result on 2026-07-30T19:02:13Z: 76 tests executed, 53 baseline green, 23
  expected red.
- Green evidence includes the current whole-node identity replacement bypass
  reproducing as `applied`, explicit `#id` metadata compatibility no-op,
  same-id DataElement/TextElement payload update, legal list insertion,
  empty-destination move, explicit delete+add replacement, normal move,
  require-elements missing-id rejection, and legacy `applyMutations`
  compatibility for the bypass mutation.
- Expected red evidence:
  - whole-node/container update still applies hidden DataElement/TextElement
    identity replacement, body identity remove/swap, Extend order relocation,
    and attributes-container identity replacement.
  - direct metadata fallback id add/update/delete still applies in identity mode
    instead of rejecting when metadata id is the active identity authority.
  - same-value authority transitions between explicit `#id` and metadata
    fallback still apply.
  - occupied property/map/Extend add and cross-parent move destinations still
    overwrite identified occupants.
  - `diffNodes` still emits `TREE_UPDATE ...:extend:order` for identified and
    missing-id Extend reorder.
  - Extend retag+reorder in both directions lacks `destinationKey` and still
    relies on order updates.
  - standalone incoherent Extend retag still applies instead of
    `RESULT_STRUCTURE_INVALID`.
  - add-only Extend key collision still applies; delete-then-add replacement is
    green in the same characterization.

## P1 Phase Attractor Gap

- Fresh coding review confirmed the existing 23 red assertions are meaningful,
  but found four missing characterization families.
- Reopen P1-T1 to add container-update identity insertion, whole-metadata-map
  fallback change/removal, cross-parent move into occupied Extend key/index,
  and same-index same-identity Extend retag using `destinationKey`.
- P1 remained ACTIVE until the characterization evidence gap was closed.

## P1 Phase Attractor Gap Closure

- Added characterization-only coverage for the four P1 attractor gaps in
  `packages/core/tests/mutation-authoring-characterization.test.ts`; no
  production, README, or dist files were edited in this closure pass.
- Added expected-red strict rejection coverage for container update that adds an
  identified descendant to an existing body container.
- Added expected-red strict rejection coverage for whole `:metadata` map
  replacement that changes the active metadata fallback identity and for
  replacement that removes it.
- Added expected-red strict rejection coverage for cross-parent Extend move into
  an occupied keyed destination and into an occupied destination resolved by
  `destinationKey`; both assert the rejected batch returns an unchanged base
  clone, preserving the source.
- Added expected-red diff/apply characterization for same-index same-identity
  Extend retag: `diffNodes` must emit a structural `TREE_MOVE_SAME_LEVEL` with
  `destinationKey` for key migration plus the explicit tag update, not just
  retag/order update residue.
- Target command:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`.
- Result on 2026-07-30T19:09:02Z: 82 tests executed, 53 baseline green, 29
  expected red. The six new red assertions correspond exactly to the four
  missing families above.
- AC2 and AC5 now have sufficient characterization evidence; P1-T1 and P1 were
  marked DONE in `track.xml` under manual commit mode.

## P1 Phase Closure

- Parent rerun confirmed `82 tests`, with `29` behavior-driving expected red
  assertions and `53` legal/legacy baselines green.
- Strict Codument validation and XML parsing passed; characterization edits
  remained confined to tests and Track evidence.
- A new fresh coding AttractorCheck reported PASS with no blocking or
  non-blocking findings.
- P2 owns converting all 29 expected red assertions to green without
  regressing the 53 baselines.

## P2-T1 Parent Spot-Check Gap

- Core full tests and lint passed, but parent-generated mixed scenarios exposed
  two uncovered Extend parity defects.
- Missing-identity reorder mixed with a new child used a stale `pathBefore`
  index after lower-index insertion, producing the wrong order.
- Cross-parent same-identity retag did not propagate the target tag as
  `destinationKey` through delete/add move reconciliation, so final coherence
  rejected an otherwise valid target.
- Reopen P2-T1 and AC4 until both scenarios have regression tests and
  diff-to-strict-apply parity.

## P2-T1 Permutation Gap

- After the first spot-check fix, parent enumerated 72 identified/missing-id
  Extend permutations with reorder, add, and delete combinations.
- Nine missing-id cases still failed parity because `diffExtend` pre-inserted
  all new tags into its simulated order before emitting lower-index moves,
  while `orderMutations` executes adds and moves incrementally by target index.
- The required fix is to simulate unmatched insertion inline in the same
  ascending target-index loop that emits moves, then retain the permutation
  matrix as a regression/property test.

## P2 Parent Verification

- Parent independently reran the final core suite (`226` tests), TypeScript
  lint, build, ESM/CJS imports, strict Codument validation, and dist residue
  smoke; all passed.
- An additional ephemeral exhaustive check evaluated `8,450` old/target Extend
  pairs from every permutation of every subset of four tags, in both identified
  and missing-identity modes. Every pair satisfied
  `diff -> strict dry-run -> zero diff to target`.
- The durable test suite retains a smaller 72-case permutation matrix so the
  core structural failure mode remains reproducible in normal CI.
- Fresh P2 coding AttractorCheck returned PASS. Its only note was that the
  exhaustive parent run was not yet written to durable evidence; this section
  records that evidence.

## P2-T1 Implementation Evidence

- Implemented ordered full-tree identity skeleton validation for strict
  update mutations in `packages/core/src/mutation/index.ts`. The descriptor
  records both identity value and authority source (`explicit-id` vs
  `metadata-fallback`) and compares the full tree before/after each update.
- Added strict direct metadata fallback id rejection when metadata id is the
  active identity authority; explicit `#id` precedence keeps the existing
  identity-mode compatibility no-op.
- Added strict occupied destination validation for add/move before source
  extraction. Ordinary array insertion remains eligible; assignment-style
  property/map/Extend writes reject occupied identified destinations.
- Added optional `XnlMutation.destinationKey` and path insertion support so
  Extend same-identity retag migrates the children key/order structurally
  before payload tag update.
- Reworked Extend diff so reorder is emitted as explicit
  `TREE_MOVE_SAME_LEVEL` using identity when present and `pathBefore` when
  missing-id; no `TREE_UPDATE ...:extend:order` remains in the characterization
  cases.
- Added batch-final Extend order/key/tag coherence validation returning
  `RESULT_STRUCTURE_INVALID`, while allowing move-then-retag intermediate
  states inside the same strict batch.
- Updated the characterization assertion for the former whole-node bypass from
  its P1 expected-red behavior to the fixed P2 rejection behavior; no README or
  dist edits were made for P2-T1.
- Verification on 2026-07-30T19:21:51Z:
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
    passed: 82 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-parity.test.ts`
    passed: 2 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test`
    passed: 14 test files, 149 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core lint`
    passed: `tsc --noEmit`.
- P2-T1 acceptance criteria AC1-AC4 were marked checked and task status set to
  DONE in `track.xml` under manual commit mode. P2 remains ACTIVE because P2-T2
  owns README/dist/build/residue verification.

## P2-T1 Parent Spot-Check Gap Closure

- Added four regression tests to
  `packages/core/tests/mutation-authoring-characterization.test.ts` for the
  parent spot-check gaps before changing production code.
- Red evidence on 2026-07-30T19:28:14Z:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
  failed with 4 failures out of 86 tests.
- Red failures covered:
  - allow-missing Extend add-at-head plus missing-id reorder, where diff used
    a stale `pathBefore` and moved `alpha` from old index 0 to target index 2
    instead of simulating the lower-index insertion and moving `beta` from
    current index 2 to target index 1.
  - the same structural insertion simulation bug with delete + add-at-head +
    missing-id reorder.
  - cross-parent same-id Extend retag to destination head and destination tail,
    where `reconcileMoves` produced `TREE_MOVE_CROSS_LEVEL` without
    `destinationKey: "new"`.
- Fixed `diffExtend` in `packages/core/src/mutation/index.ts` to initialize the
  reorder working order after simulating retained deletes and all new Extend
  structural insertions at their target indexes. This makes pathBefore for
  missing-id moves reflect the ordered batch state rather than the original
  retained-only order.
- Fixed `reconcileMoves` to derive and propagate `destinationKey` from the
  paired add side when delete/add reconciliation creates an Extend move whose
  destination child tag differs from the source tag. Ordinary non-retag moves
  do not gain an unnecessary destinationKey.
- Green verification on 2026-07-30T19:29:10Z:
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
    passed: 86 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test`
    passed: 14 test files, 153 tests. This preserves the previous 149-test
    suite and adds the four new regression cases.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core lint`
    passed: `tsc --noEmit`.
- No README or dist files were edited in this closure pass. P2-T1 AC4 is now
  checked true and P2-T1 is DONE again under manual commit mode.

## P2-T1 Permutation Gap Closure

- Added a stable Extend permutation matrix to
  `packages/core/tests/mutation-authoring-characterization.test.ts` covering
  all 72 parent-enumerated cases:
  - old order `[a,b,c]` to every permutation of `[a,b,c]`, `[a,b,n]`, and
    `[a,b,c,n]`;
  - both identified children and missing-id children under
    `identityPolicy: "allow-missing"`.
- Red evidence on 2026-07-30T19:39:06Z:
  `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
  failed with 9 missing-id permutation parity failures out of 159 tests. The
  failing labels matched the parent-reported matrix gap: `missing-id b,n,a`,
  `missing-id a,c,n,b`, `missing-id b,c,n,a`, `missing-id b,n,a,c`,
  `missing-id b,n,c,a`, `missing-id c,a,n,b`, `missing-id c,b,n,a`,
  `missing-id c,n,a,b`, and `missing-id c,n,b,a`.
- Fixed `diffExtend` in `packages/core/src/mutation/index.ts` so the
  `newIndex` ascending loop now emits and simulates unmatched `TREE_ADD`
  insertions inline before later matched moves calculate `pathBefore`. Matched
  children still calculate moves from the current simulated `workingOrder` and
  same-identity retag continues to carry `destinationKey`.
- Cross-parent same-identity retag destinationKey coverage remains protected by
  the existing head/tail tests added in the parent spot-check closure; the
  permutation fix did not change `reconcileMoves`.
- Green verification on 2026-07-30T19:39:55Z:
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
    passed: 159 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts -t "Extend permutation"`
    passed: 73 tests, 86 skipped.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-parity.test.ts`
    passed: 2 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test`
    passed: 14 test files, 226 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core lint`
    passed: `tsc --noEmit`.
- No README or dist files were edited in this closure pass. P2-T1 AC4 is true
  and P2-T1 is DONE again under manual commit mode.

## P2-T2 Documentation And Core Verification Matrix

- Updated `packages/core/README.md` Mutation preview docs to state strict
  identity continuity explicitly:
  - `#id` is only for diff alignment, move detection, and target addressing;
    it is not ordinary mutation payload.
  - Strict update mutations reject whole-node/container identity replacement,
    including identity add/remove/swap/relocate and explicit-id versus
    metadata-fallback authority transitions, with
    `IDENTITY_MUTATION_FORBIDDEN`.
  - Assignment-style property/map/Extend writes use a destination guard and
    reject occupied identified destinations with
    `IDENTITY_MUTATION_FORBIDDEN`; ordinary array insertion and empty
    assignment destinations remain valid.
  - Extend reorder is expressed as move, not
    `TREE_UPDATE ...:extend:order`; Extend retag uses optional
    `destinationKey` for key migration.
  - `RESULT_STRUCTURE_INVALID` is reserved for final Extend
    order/key/tag incoherence.
- Build regenerated `packages/core/dist/index.{js,cjs,d.ts,d.cts}` and source
  maps from `packages/core/src/index.ts` via the package build.
- Verification on 2026-07-30T19:45:38Z:
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts`
    passed: 159 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test`
    passed: 14 test files, 226 tests.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core lint`
    passed: `tsc --noEmit`.
  - `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core build`
    passed: `tsup src/index.ts --format esm,cjs --dts`, producing ESM, CJS,
    declarations, and source maps.
  - ESM smoke import passed:
    `node --input-type=module -e "import('./packages/core/dist/index.js')"`
    confirmed `dryRunMutations` and `diffNodes` are functions.
  - CJS smoke import passed:
    `node -e "require('./packages/core/dist/index.cjs')"` confirmed
    `dryRunMutations` and `diffNodes` are functions.
  - Public type/export scan passed across `src` and generated `dist`:
    `destinationKey?: string`, `RESULT_STRUCTURE_INVALID`,
    `diagnostics: readonly XnlMutationDiagnostic[]`, `dryRunMutations`, and
    `diffNodes` are present without changing the existing
    `dryRunMutations(base, mutations, options?)` or
    `diffNodes(oldNode, newNode, basePath?, opts?)` signatures.
  - Focus residue tests passed:
    `bun run --cwd /Users/kongweixian/lang/xnl.ts/packages/core test mutation-authoring-characterization.test.ts -t "identity replacement|element :id update|Extend reorder|Extend permutation|destinationKey|RESULT_STRUCTURE_INVALID"`
    passed 95 matching tests.
  - Dist-level residue smoke passed: identity replacement diff produced only
    `["TREE_DELETE","TREE_ADD"]`; identified Extend reorder, missing-id Extend
    reorder, and same-identity Extend retag all emitted moves, emitted no
    `TREE_UPDATE ...:extend:order`, and strict dry-run applied to the target.
- P2-T2 AC1-AC4 are satisfied. CommitMode is manual, so no commit was created.
