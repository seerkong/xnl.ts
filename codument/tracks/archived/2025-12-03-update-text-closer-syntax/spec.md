# Track Spec: update-text-closer-syntax

## 概述

本归档由 OpenSpec archived change `update-text-closer-syntax` 转换而来，保留原始归档日期 2025-12-03。
以下能力规范增量按 capability 分组，并保持原 OpenSpec delta 内容。

## Capability: xnl-formatter

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

## Capability: xnl-parser

## MODIFIED Requirements
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
