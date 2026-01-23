## ADDED Requirements
### Requirement: Parse XNL documents
The system SHALL parse XNL strings into an AST where each element node includes its tag name, attributes, body type (`map`, `array`, `uniqueChildren`, `raw`, `text`, or `void`), and typed body content determined by the opening delimiter (`{>`, `[>`, `{[>`, `(>`, `>`, or self-closing). Element node type names for tagged nodes SHALL be `MapContentElementNode`, `ArrayContentElementNode`, `UniqueElementNode`, `RawElementNode`, `TextElementNode`, and `VoidNode` to distinguish them from literal object/array value nodes.

#### Scenario: Mixed content parsed to AST
- **WHEN** a document containing map, array, unique-children, raw-code, text, and self-closing nodes is parsed
- **THEN** each node in the AST reflects the correct body type and preserves order and nesting

### Requirement: Enforce structural rules
The parser SHALL reject malformed XNL documents, including mismatched tags and invalid content inside typed bodies. Duplicate child names inside `{[>` blocks SHALL be allowed with the later child overwriting the earlier while emitting a warning that is programmatically accessible (not just logged).

#### Scenario: Invalid content triggers error
- **WHEN** text or mixed nodes appear inside `[>` or `{>` bodies, or a closing tag does not match its opener
- **THEN** the parser raises a descriptive error instead of returning an AST

#### Scenario: Duplicate names warn and overwrite in unique-children
- **WHEN** a `{[>` block contains two child nodes sharing the same tag name
- **THEN** the parser emits a warning and the later child overwrites the earlier entry while preserving appearance order

### Requirement: Attribute value decoding
The parser SHALL decode attribute values according to XNL syntax: `{...}` → nested object, `[...]` → array, `(...)` → expression value kept as a raw string, `<(>...<)name>` → raw text value, and JSON-style bare literals (`true`/`false`, `null`, numbers) coerced to native types while other bare identifiers become strings; malformed attribute literals are rejected.

#### Scenario: Structured attributes parsed
- **WHEN** attributes include nested objects, arrays, expression wrappers, and raw code blocks
- **THEN** the parsed attribute map contains typed values reflecting those structures

#### Scenario: JSON literals coerced
- **WHEN** attributes use bare literals like `id=123` (integer) or `rate=2.5` (float) or `active=false`
- **THEN** the parser returns numbers for `id`/`rate` (with integer/float kind preserved) and a boolean for `active` without requiring quotes

#### Scenario: Malformed attribute literal errors
- **WHEN** an attribute literal is missing closing delimiters or uses mixed delimiters incorrectly
- **THEN** the parser raises an error describing the malformed attribute

### Requirement: Raw code preservation
The parser SHALL treat `(>` blocks as raw content, preserving the inner text verbatim (including fragment syntax like `<></>` or `<[><]>`) while still requiring the correct closing tag for the node name.

#### Scenario: Raw block returned verbatim
- **WHEN** a node with `(>` content is parsed
- **THEN** the parser returns the raw string exactly as written and errors if the closing tag does not match

#### Scenario: Raw block dedents using closing indent
- **WHEN** a raw block opens and closes on different lines and the closing tag is indented
- **THEN** the parser trims a leading blank line and removes the closing tag’s indentation prefix (spaces/tabs) from each content line, similar to C# triple-quoted strings

### Requirement: Package distribution
The project SHALL expose the parser and AST types via a package consumable from both Node and browser environments, providing ESM and CJS entry points and generated TypeScript declarations.

#### Scenario: Package importable with types
- **WHEN** consumers install the package
- **THEN** they can import `parseXnl` and AST types from the package root in ESM or CJS projects with `.d.ts` available

### Requirement: Grammar reference
The project SHALL document an EBNF description of the XNL syntax (tags, attributes, bodies, and literal decoding rules) to keep parser behavior aligned and testable.

```
Document            = S? Node* ;
Node                = Element | SelfClosing ;
Element             = TextElement | MapElement | ArrayElement | UniqueChildrenElement | RawElement ;
TextElement         = "<" Name Attrs? ">" TextContent "</" Name ">" ;
MapElement          = "<" Name Attrs? "{>" MapEntries "<}" Name ">" ;
ArrayElement        = "<" Name Attrs? "[>" ArrayItems "<]" Name ">" ;
UniqueChildrenElement = "<" Name Attrs? "{[>" Node* "<]}" Name ">" ;
RawElement          = "<" Name Attrs? "(" RawMarker? ">" RawText "<" RawMarker? ")" Name ">" ;  (* RawMarker must match when present *)
SelfClosing         = "<" Name Attrs? "/>" ;

Attrs               = (S Attribute)* ;
Attribute           = Name S? "=" S? AttrValue ;
AttrValue           = Literal | ObjectLiteral | ArrayLiteral | ExpressionLiteral | RawLiteral ;

MapEntries          = (S? MapEntry S?)* ;
MapEntry            = Name S? "=" S? ValueLiteral ;
ArrayItems          = (S? (ValueLiteral | Node) S?)* ;

ValueLiteral        = Literal | ObjectLiteral | ArrayLiteral | ExpressionLiteral | RawLiteral ;
ObjectLiteral       = "{" (S? MapEntry (S MapEntry)*)? S? "}" ;
ArrayLiteral        = "[" (S? ValueLiteral (S ValueLiteral)*)? S? "]" ;
ExpressionLiteral   = "(" ExprText ")" ;         (* kept as raw expression string *)
RawLiteral          = "<(" RawMarker? ">" RawText "<" RawMarker? ")" ;       (* kept verbatim; RawMarker must match when present *)
RawMarker           = IdentifierString ;

Literal             = Boolean | Null | Number | String | IdentifierString ;
Boolean             = "true" | "false" ;
Null                = "null" ;
Number              = Integer | Float ;
Integer             = ("+"|"-")? DIGIT+ ;
Float               = ("+"|"-")? DIGIT+ ("." DIGIT+)? ( ("e"|"E") ("+"|"-")? DIGIT+ )? ;
String              = "\"" ( CHAR - "\"" )* "\"" ;
IdentifierString    = IdentifierStart IdentifierChar* ;   (* decoded as string *)

TextContent         = (CHAR)* ;                  (* plain text, consumed until matching closing tag even if it contains '<' *)
RawText             = (CHAR)* ;                  (* consumed until matching closing marker *)
Name                = Identifier ;
Identifier          = IdentifierStart IdentifierChar* ;
IdentifierStart     = ALPHA | "_" ;
IdentifierChar      = IdentifierStart | DIGIT | "-" ;
S                   = ( " " | "\t" | "\r" | "\n" )+ ;
CHAR                = any Unicode code point ;
DIGIT               = "0".."9" ;
```

- `{[>` blocks require unique `Name` per child node.
- Bare literals decode JSON-style: `true`/`false` → boolean, `null` → null, `Number` → numeric (integers vs floats distinguished by syntax), other `IdentifierString` → string; quoted `String` stays string.
- Raw blocks support optional markers (`[A-Za-z_-]+`) between `(>` and `<)`; if markers are present they must match to close, otherwise content continues as text.
- Numeric literals retain kind: integers vs floats. TypeScript implementation returns `number` values but preserves the numeric kind metadata for potential mapping to long/double in other language targets.
- Text and raw blocks that span multiple lines SHALL dedent by the whitespace prefix (spaces/tabs) of the closing tag line: drop a leading empty line if present, then strip that prefix from each line (C# triple-quoted string style).

#### Scenario: EBNF is available
- **WHEN** developers read the spec
- **THEN** they can find the EBNF block describing tags, attributes, literals, and body forms to align parser and tests
- **API additions:** Provide `parseXnlSingleNode` (returns `{ node, warnings }`) to parse exactly one node and `parseUniqueChildren(name, input, attrs?)` (returns `{ node, warnings }`) to build a `uniqueChildren` node from sibling elements, applying the same duplicate-handling semantics (warn + overwrite). `parseXnl` returns `{ nodes, warnings }`.
