# xnl-formatter Specification

## Purpose
TBD - created by archiving change add-xnl-formatter. Update Purpose after archive.
## Requirements
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

### Requirement: AST ordering and determinism
The formatter SHALL preserve node order (document nodes, unique-children order array, array items order) and attribute iteration order when serializing.

#### Scenario: Stable output
- **WHEN** serializing the same AST twice
- **THEN** the outputs are identical strings

### Requirement: Attribute and literal emission
The formatter SHALL emit attributes and literal values according to XNL syntax: objects as `{ key = value }`, arrays as `[ ... ]`, expressions as `(expr)`, raw literals with markers retained, and numbers/booleans/null/strings rendered canonically; numeric kind metadata does not change emitted syntax beyond integer vs float representation.

#### Scenario: Attribute literals preserved
- **WHEN** attributes include nested objects/arrays, expressions, raw literals, and numeric kinds
- **THEN** `XNL.stringify` emits syntactically correct XNL that round-trips to equivalent literals

### Requirement: XNL namespace availability
The formatter package SHALL expose the `XNL` namespace alongside `stringify`, with parse helpers named `parseMany`, `parseSingle`, and `parseUnique` to mirror parser capabilities.

#### Scenario: Namespace uses parseMany
- **WHEN** consumers import the XNL namespace
- **THEN** they find `parseMany`, `parseSingle`, `parseUnique`, and `stringify` as the supported API surface

### Requirement: Comment preservation in formatting
The formatter SHALL accept and emit XML-style comments `<!-- ... -->` in the serialized XNL output, preserving their relative position to nodes and text in both compact and pretty modes.

#### Scenario: Comments serialized compactly
- **WHEN** comments are present between nodes and compact mode is used
- **THEN** the formatter includes `<!-- ... -->` without introducing extra newlines beyond compact spacing

#### Scenario: Comments serialized in pretty mode
- **WHEN** comments are present and pretty mode is used
- **THEN** the formatter places comments on their own lines aligned to the current indentation level to preserve readability

