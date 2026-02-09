# xnl-parser Specification

## Purpose
TBD - created by archiving change add-xnl-parser. Update Purpose after archive.
## Requirements
### Requirement: Parse XNL documents
The system SHALL parse XNL strings into an AST where each element node includes its tag name, attributes, body type (`Map`, `Array`, `UniqueChildren`, `Raw`, `Text`, or `Void`), and typed body content determined by the opening delimiter (`{>`, `[>`, `{[>`, `(>`, `>`, or self-closing). Element node type names for tagged nodes SHALL be `MapContentElementNode`, `ArrayContentElementNode`, `UniqueElementNode`, `RawElementNode`, `TextElementNode`, and `VoidNode` to distinguish them from literal object/array value nodes.

#### Scenario: Mixed content parsed to AST
- **WHEN** a document containing map, array, unique-children, raw-code, text, and self-closing nodes is parsed
- **THEN** each node in the AST reflects the correct body type and preserves order and nesting

### Requirement: Enforce structural rules
The parser SHALL reject malformed short-form XNL, including unmatched closers (`}>`, `]>`, `)>`, `</#...>`), non-unique tag names inside extend blocks, or invalid content types (e.g., non-node content inside extend). Extend blocks SHALL only contain child tags; text blocks SHALL not mix with `[]`/`()` on the same node (but may include metadata and `{}` attributes); inline metadata/attribute literals must follow the updated literal rules. Errors MUST include the offending tag/marker name when applicable, the expected closing delimiter, and position info (line/column) to aid debugging.

#### Scenario: Unclosed tag reports name and position
- **WHEN** parsing `<a [ 1 2` and the closing `]`/`>` is missing
- **THEN** the parser raises an error that names tag `a`, indicates the missing closing delimiter, and includes line/column in the message

#### Scenario: Mismatched text marker reports both markers
- **WHEN** parsing `<note#flag>hi</#other>`
- **THEN** the parser raises an error that mentions the expected marker `flag`, the found `other`, and provides line/column

#### Scenario: Invalid mixed content reports parent tag
- **WHEN** a text tag `<note #>... </#>` also contains a `[` block
- **THEN** the parser raises an `INVALID_CONTENT` error that cites parent tag `note`, the disallowed section type, and includes line/column

### Requirement: Attribute value decoding
The parser SHALL decode attribute values according to XNL syntax: `{...}` → nested object, `[...]` → array, `(...)` → expression value kept as a raw string, `<(>...<)name>` → raw text value, and JSON-style bare literals (`true`/`false`, `null`, numbers) coerced to native types while other bare identifiers become strings; malformed attribute literals are rejected. Value `kind` strings SHALL be PascalCase: `String`, `Boolean`, `Null`, `Number` (with numeric kind `Integer`|`Float`), `Expression`, `Raw`, `Object`, `Array`.

#### Scenario: Structured attributes parsed
- **WHEN** attributes include nested objects, arrays, expression wrappers, and raw code blocks
- **THEN** the parsed attribute map contains typed values reflecting those structures

#### Scenario: JSON literals coerced
- **WHEN** attributes use bare literals like `id=123` (integer) or `rate=2.5` (float) or `active=false`
- **THEN** the parser returns numbers for `id`/`rate` (with numeric kind preserved as `Integer` or `Float`) and a boolean for `active` without requiring quotes

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

#### Scenario: Namespaced parse helpers
- **WHEN** consumers prefer a single namespace
- **THEN** they can call `XNL.parseMany`, `XNL.parseSingle`, and `XNL.parseUnique` which delegate to existing parse helpers and surface warnings, in addition to the existing direct functions

### Requirement: Grammar reference
The project SHALL document an EBNF description of the XNL syntax (tags, attributes, bodies, and literal decoding rules) to keep parser behavior aligned and testable.

```
Document            = S? Node* ;
Node                = TextNode | Element | VoidNode ;
Element             = "<" Name Metadata? Sections ">" ;
VoidNode            = "<" Name Metadata? ">" ;
TextNode            = "<" Name Metadata? AttributeBlock? "#" TextMarker? ">" TextContent "</#" TextMarker? ">" ;

Metadata            = (S Attribute)* ;
Attribute           = Key S? "=" S? ValueNode ;
Key                 = Name | String ;

Sections            = (AttributeBlock | ArrayBlock | ExtendBlock)+ ;
AttributeBlock      = "{" MapEntries "}" ;
ArrayBlock          = "[" ArrayItems "]" ;
ExtendBlock         = "(" ExtendChildren ")" ;

MapEntries          = (S? MapEntry S?)* ;
MapEntry            = Key S? "=" S? ValueNode ;
ArrayItems          = (S? ValueNode S?)* ;
ExtendChildren      = (S? Element S?)* ;            (* child tag names must be unique *)

ValueNode           = Literal | ObjectLiteral | ArrayLiteral | Element | Comment ;
ValueLiteral        = Literal ;                     (* primitive-only *)
ObjectLiteral       = "{" (S? MapEntry (S MapEntry)*)? S? "}" ;
ArrayLiteral        = "[" (S? ValueNode (S ValueNode)*)? S? "]" ;

Literal             = Boolean | Null | Number | String | IdentifierString ;
Boolean             = "true" | "false" ;
Null                = "null" ;
Number              = Integer | Float ;
Integer             = ("+"|"-")? DIGIT+ ;
Float               = ("+"|"-")? DIGIT+ ("." DIGIT+)? ( ("e"|"E") ("+"|"-")? DIGIT+ )? ;
String              = DoubleString | SingleString ;
DoubleString        = "\"" ( CHAR - "\"" )* "\"" ;
SingleString        = "'" ( CHAR - "'" )* "'" ;
IdentifierString    = IdentifierStart IdentifierChar* ;   (* decoded as string *)
TextMarker          = IdentifierString ;

TextContent         = (CHAR)* ;                  (* plain text, dedented by closing tag indentation *)
Name                = Identifier ;
Identifier          = IdentifierStart IdentifierChar* ;
IdentifierStart     = ALPHA | "_" ;
IdentifierChar      = IdentifierStart | DIGIT | "-" ;
S                   = ( " " | "\t" | "\r" | "\n" )+ ;
CHAR                = any Unicode code point ;
DIGIT               = "0".."9" ;
Comment             = "<!--" (CHAR - "-->")* "-->" ;
```

- `{[>` blocks require unique `Name` per child node.
- Bare literals decode JSON-style: `true`/`false` → boolean, `null` → null, `Number` → numeric (integers vs floats distinguished by syntax), other `IdentifierString` → string; quoted `String` stays string.
- Raw blocks support optional markers (`[A-Za-z_-]+`) between `(>` and `<)`; if markers are present they must match to close, otherwise content continues as text.
- Numeric literals retain kind: integers vs floats. TypeScript implementation returns `number` values but preserves the numeric kind metadata for potential mapping to long/double in other language targets.
- Text and raw blocks that span multiple lines SHALL dedent by the whitespace prefix (spaces/tabs) of the closing tag line (`</#...>` for text): drop a leading empty line if present, then strip that prefix from each line (C# triple-quoted string style).

#### Scenario: EBNF is available
- **WHEN** developers read the spec
- **THEN** they can find the EBNF block describing tags, attributes, literals, and body forms (including the `</#...>` text closers) to align parser and tests

### Requirement: Comment support
The parser SHALL recognize XML-style comments `<!-- ... -->` in XNL input and ignore them in the returned AST while preserving correct parsing of surrounding nodes and text.

#### Scenario: Comments between nodes
- **WHEN** comments appear between sibling nodes
- **THEN** the parser skips them without affecting node order or content

#### Scenario: Comments in text-friendly bodies
- **WHEN** comments appear inside text or raw-friendly regions
- **THEN** the parser ignores them without altering the parsed text/raw content boundaries

### Requirement: Grammar includes comments
The XNL grammar SHALL define `Comment = \"<!--\" (CHAR - \"-->\")* \"-->\"` as an ignorable token allowed wherever whitespace is permitted between nodes or within text/raw regions.

#### Scenario: Grammar documents comments
- **WHEN** developers read the grammar
- **THEN** they see the comment production and its placement rules

