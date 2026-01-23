## MODIFIED Requirements
### Requirement: Enforce structural rules
The parser SHALL reject malformed short-form XNL, including unmatched closers (`}>`, `]>`, `)>`, `<#...>`), non-unique tag names inside extend blocks, or invalid content types (e.g., non-node content inside extend). Extend blocks SHALL only contain child tags; text blocks SHALL not mix with `[]`/`()` on the same node (but may include metadata and `{}` attributes); inline metadata/attribute literals must follow the updated literal rules. Errors MUST include the offending tag/marker name when applicable, the expected closing delimiter, and position info (line/column) to aid debugging.

#### Scenario: Unclosed tag reports name and position
- **WHEN** parsing `<a [ 1 2` and the closing `]`/`>` is missing
- **THEN** the parser raises an error that names tag `a`, indicates the missing closing delimiter, and includes line/column in the message

#### Scenario: Mismatched text marker reports both markers
- **WHEN** parsing `<note#flag>hi<#other>`
- **THEN** the parser raises an error that mentions the expected marker `flag`, the found `other`, and provides line/column

#### Scenario: Invalid mixed content reports parent tag
- **WHEN** a text tag `<note #>...<#>` also contains a `[` block
- **THEN** the parser raises an `INVALID_CONTENT` error that cites parent tag `note`, the disallowed section type, and includes line/column
