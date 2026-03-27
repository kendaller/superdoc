# Phase 7: Coverage Expansion Plan

Updated: March 2026

## Current Coverage (end of Phase 6)

### Semantic Operations Implemented
- `insertText`, `splitParagraph`, `mergeParagraphs`, `insertParagraph`, `setParagraphStyle`, `toggleBold`

### Entity Kinds with Full Lifecycle
- **Paragraph**: read + write + project + analyze + JSON
- **Run**: read + write + project + analyze + JSON
- **Table/Row/Cell**: read + project + analyze + JSON
- **Section**: read + project + analyze + JSON
- **ContentControl (SDT)**: read + project (transparent) + analyze
- **Bookmark/CommentRange**: read + analyze (start-marker only)
- **RevisionRange/FieldRange**: read + analyze

### Not Yet Covered
Entity kinds that are type-only or thin:
- `mediaResource` — media resolution from relationships
- `permissionRange` — permission range pairing
- `mathObject` — Office Math equation processing
- `textboxStory` — AlternateContent textbox discovery

## Expansion Priorities (Phase 7+)

### Priority 1: High corpus frequency, blocks parity
| Feature | Corpus Frequency | Current Status | Target |
|---------|-----------------|----------------|--------|
| Image/drawing projection | Very high | Entity exists, projection skipped | Full image resolution + ImageBlock projection |
| Field display values | High | Field range entities exist, display not projected | PAGE/DATE/TOC field value computation |
| Tracked changes visibility | High | RevisionRange entities exist, mode filtering placeholder | Full review/original/final mode filtering in projection |
| List rendering | High | Numbering properties extracted | Full list marker computation via numbering resolver |

### Priority 2: Medium corpus frequency
| Feature | Current Status | Target |
|---------|----------------|--------|
| Table style resolution | Style resolver exists | Full conditional table style cascade (firstRow, band1Horz, etc.) |
| Header/footer rendering | Stories populated | Header/footer content projected in section-aware layout |
| Footnote/endnote rendering | Stories populated | Note reference → note body linking in projection |
| Comment rendering | Stories populated | Comment thread display in margin/sidebar |

### Priority 3: Lower frequency, new capabilities
| Feature | Current Status | Target |
|---------|----------------|--------|
| mc:AlternateContent | Not implemented | Branch selection (prefer DrawingML Choice over VML Fallback) |
| Office Math | Type-only | Equation structure parsing + display |
| OLE/embedded objects | Preserved | Basic placeholder display |
| Textbox stories | Type-only | AlternateContent textbox discovery + nested story |
| Permission ranges | Type-only | Range pairing + access control metadata |

## Semantic Operation Expansion (Phase 7+)

### Next operation set
| Operation | Exercises | Priority |
|-----------|-----------|----------|
| `toggleItalic` | Character formatting (same pattern as toggleBold) | High |
| `setFontSize` | Character formatting with value | High |
| `setFontFamily` | Character formatting with string value | High |
| `setAlignment` | Paragraph formatting | High |
| `setNumbering` | Numbering reference mutation | High |
| `addComment` | Cross-part mutation (needs pkg.addPart) | Medium |
| `createFootnote` | Cross-part mutation | Medium |
| `insertTable` | Structural creation | Medium |
| `mergeCells` | Table structure mutation | Medium |
| `setSectionProperties` | Section mutation | Medium |

## Acceptance Criteria Tracking

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1. v2/model is canonical foundation | Done | SemanticModel API, 34 entity kinds |
| 2. PM no longer required as core | Phase 6 | Document-api adapter provides v2-backed path |
| 3. super-converter no longer SOT | Phase 6 | Translators ported to v2/model |
| 4. Current features have parity | Partial | Layout projection covers paragraphs/tables/sections |
| 5. Unsupported OOXML preserved | Done | PreservedBlock/PreservedRange + diagnostics |
| 6. Stable semantic vocabulary | Done | 34 entity kinds + 6 semantic operations |
| 7. Layout from v2/model | Done | projectToFlowBlocks() with resolver integration |
| 8. Analysis from v2/model | Done | projectToOccurrences() with trace chains |
| 9. Semantic JSON | Done | projectToSemanticJson() |
| 10. Shadow-mode parity | Pending | Infrastructure exists, corpus validation needed |
| 11. Performance budgets | Pending | Budgets defined, benchmarks needed |
| 12. Scalable/lazy/enterprise | Done | Lazy tier construction, rebuild on mutation |
| 13. Kernel invariants tested | Done | Intent-preservation validation on every operation |
| 14. Malformed OOXML classified | Done | 15 diagnostic codes, structured diagnostics |
| 15. Intent-preservation enforced | Done | validate.ts checks every compiled operation |
