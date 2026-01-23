## MODIFIED Requirements
### Requirement: XNL stringify API
The system SHALL provide `XNL.stringify(value, options?)` that serializes an XNL AST (`XnlDocument` or `XnlNode`) into a valid XNL string. The default output is compact single-line; when `options.pretty` is true, output is pretty-printed using an `indent` option (number of spaces or string).

#### Scenario: Compact stringify
- **WHEN** `XNL.stringify` is called without options
- **THEN** the returned string is a single line with minimal spaces and can be parsed back to an equivalent AST

#### Scenario: Pretty stringify with indent
- **WHEN** `XNL.stringify` is called with `{ pretty: true, indent: 2 }`
- **THEN** map entries, array items, and child elements are split onto new lines with the given indentation per nesting level while preserving order

#### Scenario: Raw/text preservation
- **WHEN** nodes contain text or raw bodies (including markers)
- **THEN** `XNL.stringify` emits the bodies without altering their content beyond existing dedent rules and preserves matching markers plus the new `</#marker?>` closing tags
