## ADDED Requirements
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
