## ADDED Requirements
### Requirement: XNL namespace availability
The formatter package SHALL expose the `XNL` namespace alongside `stringify`, with parse helpers named `parseMany`, `parseSingle`, and `parseUnique` to mirror parser capabilities.

#### Scenario: Namespace uses parseMany
- **WHEN** consumers import the XNL namespace
- **THEN** they find `parseMany`, `parseSingle`, `parseUnique`, and `stringify` as the supported API surface
