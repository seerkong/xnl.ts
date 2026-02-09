## ADDED Requirements
### Requirement: Comment preservation in formatting
The formatter SHALL accept and emit XML-style comments `<!-- ... -->` in the serialized XNL output, preserving their relative position to nodes and text in both compact and pretty modes.

#### Scenario: Comments serialized compactly
- **WHEN** comments are present between nodes and compact mode is used
- **THEN** the formatter includes `<!-- ... -->` without introducing extra newlines beyond compact spacing

#### Scenario: Comments serialized in pretty mode
- **WHEN** comments are present and pretty mode is used
- **THEN** the formatter places comments on their own lines aligned to the current indentation level to preserve readability
