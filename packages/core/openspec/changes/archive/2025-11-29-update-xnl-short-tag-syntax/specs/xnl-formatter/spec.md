## MODIFIED Requirements
### Requirement: XNL stringify API
The system SHALL provide `XNL.stringify(value, options?)` that serializes the new short-form AST (`XnlDocument` or node) into valid XNL using the new closers: inline metadata on the opening tag, `{}` for attributes, `[]` for body arrays, `()` for extend blocks, and `<#...>` for text blocks. Text nodes may include metadata and `{}` attributes before `#` but SHALL NOT emit `[]` or `()` when `#` is present. The default output remains compact single-line; `{ pretty: true, indent }` yields pretty-printed output using the indent string or space count.

#### Scenario: Compact stringify with short tags
- **WHEN** `XNL.stringify` is called on a node containing inline metadata, a `{}` attribute block, a `[]` body block, and a `( )` extend block
- **THEN** the returned string is a single line such as `<n a=1 { b = 2 } [ 1 <c> ] ( <x> )>` that round-trips via `parseXnl`
- **WHEN** stringifying a text node with metadata/attributes (e.g., `metadata` + `{}` + `#`)
- **THEN** the formatter emits `<note a=1 { b = 2 } #>text<#>` and omits any `[]` or `()` sections

### Requirement: AST ordering and determinism
The formatter SHALL preserve document node order, array item order, extend `order` array, and metadata/attribute iteration order when serializing short-form sections. Sections SHALL emit in the order metadata → `{}` → `[]` → `()` or `#` (text). For text nodes, only metadata/`{}` precede `#`.

#### Scenario: Stable output with section ordering
- **WHEN** serializing the same AST twice in compact or pretty mode
- **THEN** outputs are identical and sections appear in the defined order

### Requirement: Attribute and literal emission
The formatter SHALL emit inline metadata and `{}` attribute blocks using the updated literal rules: `ValueLiteral` is primitive-only (number/boolean/null/string with escaping), quoted keys allowed in maps, and arrays/objects/metadata/attributes may contain values or child elements/comments. Parentheses are reserved for extend blocks. Numeric kind metadata does not alter emitted syntax beyond integer vs float representation.

#### Scenario: Attribute literals preserved with short syntax
- **WHEN** metadata contains `a=[1 <child>] b={c=3 d=<inner>}` and attributes block contains `{ s = 'x' "y key" = 2.3 arr = [1 <z>] }`
- **THEN** `stringify` emits `<n a=[1 <child>] b={c=3 d=<inner>} { s = 'x' "y key" = 2.3 arr = [1 <z>] }>`, and parsing it yields equivalent literals and nested elements

### Requirement: XNL namespace availability
The formatter package SHALL expose the `XNL` namespace alongside `stringify`, with parse helpers named `parseMany`, `parseSingle`, and `parseUnique` that operate on the new AST shape.

#### Scenario: Namespace uses updated AST
- **WHEN** consumers import the XNL namespace
- **THEN** they find `parseMany`, `parseSingle`, `parseUnique`, and `stringify` and can stringify/parse nodes containing metadata, attributes, body arrays, extend blocks, or text blocks

### Requirement: Comment preservation in formatting
The formatter SHALL accept Comment nodes and emit `<!-- ... -->` in the serialized XNL output, preserving their relative position to nodes in both compact and pretty modes under the new syntax.

#### Scenario: Comments serialized with short-form nodes
- **WHEN** comments are present between nodes in compact or pretty mode
- **THEN** the formatter includes `<!-- ... -->` without breaking short-form delimiters or spacing rules
