# Track Spec: add-xnl-comments

## 概述

本归档由 OpenSpec archived change `add-xnl-comments` 转换而来，保留原始归档日期 2025-11-24。
以下能力规范增量按 capability 分组，并保持原 OpenSpec delta 内容。

## Capability: xnl-formatter

## ADDED Requirements
### Requirement: Comment preservation in formatting
The formatter SHALL accept and emit XML-style comments `<!-- ... -->` in the serialized XNL output, preserving their relative position to nodes and text in both compact and pretty modes.

#### Scenario: Comments serialized compactly
- **WHEN** comments are present between nodes and compact mode is used
- **THEN** the formatter includes `<!-- ... -->` without introducing extra newlines beyond compact spacing

#### Scenario: Comments serialized in pretty mode
- **WHEN** comments are present and pretty mode is used
- **THEN** the formatter places comments on their own lines aligned to the current indentation level to preserve readability

## Capability: xnl-parser

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
