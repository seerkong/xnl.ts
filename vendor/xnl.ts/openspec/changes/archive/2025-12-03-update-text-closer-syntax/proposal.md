# Change: Use slash-prefixed text closers `</#...>`

## Why
- Some AI sources keep emitting `</#>` to close text blocks while the current syntax expects `<#>`, leading to parse errors and brittle round-trips.
- Aligning the syntax to the slash-prefixed closer should reduce generation mistakes and make the grammar more conventional.

## What Changes
- Switch text block closing tags to `</#>` / `</#marker>` across the parser, formatter, and grammar.
- Reject the legacy `<#>` / `<#marker>` closers and update error messaging and dedent rules to match.
- Update specs, EBNF, and tests to reflect the new closing tag syntax.

## Impact
- Affected specs: xnl-parser, xnl-formatter
- Affected code: parser text-body parsing, formatter emission, text block validation/dedent, related tests and fixtures
