# Project Context

## Purpose
XNL parser and tooling written in TypeScript for front-end and back-end consumption.

## Tech Stack
- TypeScript + Node.js
- tsup for builds, vitest for tests

## Project Conventions

### Code Style
- Prefer strict TypeScript; keep implementations small and readable.
- Keep comments minimal and focused on non-obvious logic.

### Architecture Patterns
- Hand-rolled parsers with clear AST typing; avoid unnecessary abstractions.

### Testing Strategy
- Unit tests with vitest. Cover happy paths and validation errors.

### Git Workflow
- Keep changes scoped; ensure working tree is clean before sharing.

## Domain Context
- XNL syntax and grammar documented in `doc/ai-guide/XnlLang.md`.

## Important Constraints
- openspec-apply rule: when applying a proposal or completing a change, always run `npm run build` and `npm run test` and ensure they pass so the code is publishable after each batch of edits.

## External Dependencies
- None beyond npm dev dependencies (TypeScript, tsup, vitest).
