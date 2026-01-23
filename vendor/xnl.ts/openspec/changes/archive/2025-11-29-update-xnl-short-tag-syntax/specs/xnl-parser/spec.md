## MODIFIED Requirements
### Requirement: Parse XNL documents
The system SHALL parse short-form XNL strings into an AST where each element node exposes its tag name plus multiple section fields: `metadata` (inline `key=value` pairs on the opening tag), optional `attributes` from a `{ ... }` block, optional array `body` from a `[ ... ]` block, optional unique-child `extend` from a `( ... )` block, and optional `text` from `#` text blocks. Text blocks are exclusive with arrays/extend: when `#` is used, `[]` and `()` cannot appear, but inline metadata and `{}` attributes are allowed (e.g., `<note a=1 {b=2} #> ... <#>`). Nodes without any block close with `>`. Extend blocks carry the same overwrite semantics as the old `{[>}` unique-children body (later duplicate tag names overwrite earlier ones while warning). `metadata`, `attributes`, object entries, and arrays hold `XnlNode`, so values or child elements can appear in those positions.

#### Scenario: Short-form mixed content parsed to AST
- **WHEN** parsing `<doc [ <no_body> <meta a=1 b={c=2}> <attrs { a = 'x' "y key" = 2.3 }> <items [ 1 <it> ]> <ext ( <a { v = 1 }> <a { v = 2 }> )> ]>`
- **THEN** the AST root has `metadata` empty, a `body` array containing void nodes, an `attributes` map for `attrs`, a `body` array for `items`, and an `extend` map where the second `<a>` overwrites the first while emitting a warning; `text` remains undefined for non-text nodes

### Requirement: Enforce structural rules
The parser SHALL reject malformed short-form XNL, including unmatched closers (`}>`, `]>`, `)>`, `<#...>`), non-unique tag names inside extend blocks, or invalid content types (e.g., non-node content inside extend). Extend blocks SHALL only contain child tags; text blocks SHALL not mix with `[]`/`()` on the same node (but may include metadata and `{}` attributes); inline metadata/attribute literals must follow the updated literal rules.

#### Scenario: Invalid or duplicate content triggers error/warning
- **WHEN** an extend block contains two children with the same tag name
- **THEN** the later child overwrites the earlier, preserves order, and a `DUPLICATE_CHILD` warning is returned
- **WHEN** a text tag `<note a=1 {b=2} #>...<#>` also includes `[` or `(` sections
- **THEN** the parser raises an error for invalid mixed content instead of returning an AST
- **WHEN** an extend block contains raw text instead of tags
- **THEN** the parser raises an `INVALID_CONTENT` error

### Requirement: Attribute value decoding
The parser SHALL decode inline metadata entries and `{}` attribute blocks using updated literal rules: numbers retain `Integer` vs `Float` metadata, booleans/null decode JSON-style, bare identifiers decode as strings, strings accept single or double quotes with `\\`, `\"`, `\'`, `\n`, `\t` escapes. `ValueLiteral` is primitive-only; object entries, array items, metadata, attributes, and body items accept any `XnlNode` (values, nested object/array, element nodes, or comments). Expression literals `(expr)` and `<(raw)>` literals are removed; parentheses now delimit extend blocks only.

#### Scenario: Structured metadata and attributes decoded
- **WHEN** parsing `<n a=[1 <inner>] b={c=3 d=<child>} { s = 'abc' "quoted key" = 2.5 bool = false arr = [1 "x" <z>] }>`
- **THEN** `metadata` contains `a` (Array mixing numbers and a child element), `b` (Object with number and element entries), and `attributes` contains `s` (String), `quoted key` (Number Float), `bool` (Boolean), and `arr` (Array with mixed items including a child node)

### Requirement: Text block handling
The parser SHALL treat `<name Metadata? AttributeBlock? #marker?> ... <#marker?>` as text nodes whose `text` content is captured verbatim (with comment stripping) and dedented: drop a leading blank line, then remove the whitespace prefix of the closing `<#...>` line from each line (spaces/tabs only). If a marker appears after `#`, the same marker is required on the closing tag.

#### Scenario: Text blocks dedent and enforce marker match
- **WHEN** parsing `<note#flag>  line1\n    line2\n<#flag>` with leading newline and indentation before `<#flag>`
- **THEN** the parser returns `text` equal to `"line1\n  line2\n"` and errors if the closing marker does not equal `flag`

### Requirement: Package distribution
The project SHALL expose the parser and AST types via a package consumable from both Node and browser environments, providing ESM and CJS entry points and generated TypeScript declarations that reflect the new multi-section node shape (`metadata`, `attributes`, `body`, `extend`, `text`) and updated value literal kinds.

#### Scenario: Package importable with updated types
- **WHEN** consumers install the package
- **THEN** they can import `parseXnl` and the new AST types from the package root in ESM or CJS projects with `.d.ts` showing the short-form node sections

### Requirement: Grammar reference
The project SHALL document an EBNF description of the short-form XNL syntax and literal decoding rules, replacing the old `{>`/`[>`/(>` forms.

```
Document            = S? Node* ;
Node                = TextNode | Element | VoidNode ;
Element             = "<" Name Metadata? Sections ">" ;
VoidNode            = "<" Name Metadata? ">" ;
TextNode            = "<" Name Metadata? AttributeBlock? "#" TextMarker? ">" TextContent "<#" TextMarker? ">" ;

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

#### Scenario: EBNF reflects short-form sections
- **WHEN** developers read the grammar
- **THEN** they see the short-form closers (`}>`, `]>`, `)>`, `<#...>`), the removal of expression/raw literals, and unique-child rules for extend blocks

### Requirement: Comment support
The parser SHALL recognize XML-style comments `<!-- ... -->` in XNL input and ignore them in the returned AST while preserving correct parsing of surrounding nodes and text; comments inside text blocks are stripped from the captured text.

#### Scenario: Comments skipped with short-form syntax
- **WHEN** comments appear between short-form nodes or inside attribute/array/extend/text sections
- **THEN** the parser skips them, still dedents text content correctly, and keeps sibling order
