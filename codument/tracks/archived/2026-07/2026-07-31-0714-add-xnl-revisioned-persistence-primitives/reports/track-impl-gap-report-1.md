# Gap Loop Round 1 Report

Track: `add-xnl-revisioned-persistence-primitives`
Scope: phase `P6`
Protocol: `cdt:GapLoop`
Round: `1`
Status: `NO_GAP`

## Inputs Read

- `proposal.md`
- `design.md`
- `behavior_deltas/xnl-revisioned-persistence/delta.xml`
- `track.xml`
- `reports/`: no historical gap reports existed before this round
- project attractor: `codument/attractors/project.md`
- implementation evidence: `analysis/findings.md`, `analysis/knowledge.md`, `decisions.xnl`
- current uncommitted implementation and package artifacts under `packages/core`, `packages/vfs`, and `packages/vcs`

## Target Comparison

P6 requires explicit package subpaths, API documentation, full package verification, ESM/CJS/type importability, and a browser-safe reachability scan for the built `xnl-vfs/revisioned-persistence` subpath. It must not expand browser-safety claims to package roots.

The current implementation satisfies the P6 target:

- `packages/vfs/package.json` exports `./revisioned-persistence` with ESM, CJS, and types entries.
- `packages/vcs/package.json` exports `./revisioned-repository` with ESM, CJS, and types entries.
- `packages/vfs/tsup.config.ts` and `packages/vcs/tsup.config.ts` include the new subpath entries.
- `packages/vfs/docs/api.md` documents the browser-safe VFS subpath, strict coordinator surface, live revision versus commit id boundary, and the hard `#id` rule.
- `packages/vcs/docs/api.md` documents the repository adapter, exact v2 checkpoint readback, checkpoint result classification, and backend durability proof.
- Built subpath artifacts exist for `.js`, `.cjs`, `.d.ts`, and `.d.cts`.

The hard identity semantic is preserved: `#id` participates in diff node alignment and move identity, is not an ordinary payload update field, and identity replacement is represented as delete plus add. The implementation uses complete-AST structural equality for persistence no-op and checkpoint verification instead of treating diff output as equality.

## Pre-P6 Regression Check

P6 packaging does not mask a failed prerequisite:

- P0/P1 identity prerequisite and contract semantics are represented in `packages/core` and VFS tests.
- P2 CAS authority/coordinator semantics are implemented in `packages/vfs/src/revisioned-persistence.ts` and covered by VFS revisioned persistence tests.
- P3 lossless v2 tree codec and legacy fallback are implemented in `packages/vcs/src/lossless-ast-codec.ts`, `packages/vcs/src/tree-converter.ts`, and repository snapshot code.
- P4 exact `Repository.commitSnapshot` restores public worktree/backend workspace and reports closed outcomes.
- P5 `RevisionedRepositoryAdapter` preserves live revision/commit identity separation, exact readback verification, stale checkpoint conflict, and truthful backend flush classification.

## Verification Run In This Round

- `bun run --cwd packages/vfs lint`: passed.
- `bun run --cwd packages/vcs lint`: passed.
- `bun run --cwd packages/vfs test`: passed, 20 files / 105 tests.
- `bun run --cwd packages/vcs test`: passed, 24 files / 103 tests.
- `bun run --cwd packages/vfs build`: passed.
- `bun run --cwd packages/vcs build`: passed.
- Package self-reference runtime imports:
  - `xnl-vfs/revisioned-persistence` ESM and CJS from `packages/vfs`: passed.
  - `xnl-vcs/revisioned-repository` ESM and CJS from `packages/vcs`: passed.
- In-memory TypeScript NodeNext smoke:
  - VFS ESM and CJS subpath type imports: 0 diagnostics.
  - VCS ESM and CJS subpath type imports: 0 diagnostics.
- Recursive browser-safety scan:
  - ESM graph from `packages/vfs/dist/revisioned-persistence.js` reached `packages/vfs/dist/revisioned-persistence.js`, `packages/vfs/dist/chunk-4CN3DHOZ.js`, and `packages/core/dist/index.js`.
  - CJS graph from `packages/vfs/dist/revisioned-persistence.cjs` reached `packages/vfs/dist/revisioned-persistence.cjs` and `packages/core/dist/index.cjs`.
  - Both graphs had 0 missing files and 0 forbidden `fs`, `path`, `crypto`, `node:fs`, `node:path`, or `node:crypto` imports.
- `git diff --check`: passed.
- `codument validate add-xnl-revisioned-persistence-primitives --strict`: passed with `track.xml OK + 1 behavior delta(s)`.

Note: package-name imports from the repository root fail under plain Node/Bun because the workspace root currently has no package symlinks for `xnl-vfs` / `xnl-vcs` in `node_modules`. Package self-reference imports from the package directories pass, matching the existing P6 evidence style and package export contract.

## Verdict

No gap was found against P6 or the prerequisite P0-P5 semantic targets. No implementation, track, behavior, or design changes were applied in this round.
