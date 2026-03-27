# Rendering Nodes Verification Report

Verified against: `notes/rendering-nodes-info.md`
Source repos: `./` (SuperDoc) and `../rendering-analysis`

---

## Findings Summary (ordered by hard-gate impact)

### 1. `authorityEntry` — Classification needs nuance (LOW impact)

The hypothesis says "Handled, not rendered" and "pm-adapter explicitly returns null." Both are **correct**. The converter is registered in `INLINE_CONVERTERS_REGISTRY` (paragraph.ts:893) but its implementation returns `null` unconditionally (authority-entry.ts:10). This is accurate and the hypothesis correctly describes it.

However, the pm-adapter exploration agent incorrectly reported it returns `TextRun` with resolved text — that claim is **wrong**. The actual code at `pm-adapter/src/converters/inline-converters/authority-entry.ts:9-10` clearly returns `null`.

**Hard-gate impact:** None — the hypothesis was already correct.

### 2. Charts — More nuance needed on import path (MEDIUM impact)

The hypothesis says charts are "Rendered" via `DrawingBlock` with `drawingKind: 'chart'`. This is **correct** for the happy path, but the import path has a fallback that should be documented:

- When a `w:drawing` element contains a `wp:anchor` or `wp:inline` with chart graphic data, the `handleChartDrawing()` function (encode-image-node-helpers.js:946) creates a proper `chart` PM node with parsed `ChartModel` data.
- When a `w:drawing` element does NOT resolve to `wp:anchor` or `wp:inline`, the drawing-translator falls back to `passthroughBlock` (drawing-translator.js:40-47). This means some unusual chart embeddings could be lost.
- On export, chart nodes with `originalXml` preserve their XML for round-trip (drawing-translator.js:65-68).

The pm-adapter has `chartNodeToDrawingBlock` in `SHAPE_CONVERTERS_REGISTRY` (paragraph.ts:936), and DomPainter delegates to `chart-renderer.ts` which supports bar/line/stock/area/scatter/bubble/radar/pie/doughnut/ofPie chart types. Unsupported chart types get a placeholder with type label.

**Hard-gate impact:** Charts inside standard `wp:anchor` or `wp:inline` wrappers are rendered. Charts in unusual containers could fall through to passthrough. For the hard gate, `drawing` items containing charts should be classified as **supported** with a note that non-standard embedding is a risk.

### 3. Endnote bodies — Confirmed gap (HIGH impact)

The hypothesis says "Endnote bodies look like a current gap in presentation rendering." This is **confirmed**:

- No `EndnotesBuilder` exists (searched `packages/super-editor/src/core/presentation-editor/`).
- No `endnotesInput` parameter in layout-bridge's `incrementalLayout.ts`.
- `PresentationEditor.ts` computes endnote numbering (line 4050-4059, 4075) but never builds layout input from endnote bodies.
- `FootnotesBuilder.ts` exists and works (lines 76-144), confirming footnote bodies ARE rendered.

**Hard-gate impact:** HIGH. The `endnote-reference` inventory bucket should be marked as **partial** — references render as superscript, but body content is absent. Documents with substantive endnote content will appear to have missing text.

### 4. Office Math — Confirmed unsupported (HIGH impact)

The hypothesis says Office Math is passthrough/unsupported. This is **confirmed**:

- `oMath-translator.js` only creates a boolean property handler (`createSingleBooleanPropertyHandler`), not a content parser.
- `oMathPara` has no handler at all — falls to passthrough (confirmed by `passthroughNodeImporter.test.js` which tests `oMathPara` → `passthroughInline`).
- `inlineContext.js` lists both `m:oMath` and `m:oMathPara` in `INLINE_NODE_NAMES`, causing them to become `passthroughInline`.
- No pm-adapter converter, no DomPainter handler, no FlowBlock type for math.
- `passthroughInline` is in `ATOMIC_INLINE_TYPES` (constants.ts:112) for position tracking only.

**Hard-gate impact:** HIGH. The `equation` inventory bucket should be classified as **unsupported**. Documents with equations will have invisible content.

### 5. `w:object` / OLE — Confirmed unsupported (HIGH impact)

The hypothesis says no explicit render path exists. This is **confirmed**:

- No handler in `v3/handlers/w/` for `w:object`.
- Zero grep hits for `w:object` in the codebase.
- Falls through to `passthroughNodeImporter.js` → `passthroughBlock` or `passthroughInline`.
- Passthrough nodes have `display: none` in the editor (passthrough.js:12) and no pm-adapter converter.

**Hard-gate impact:** HIGH. The `object` inventory bucket should be classified as **unsupported**.

### 6. `indexEntry` and `tableOfContentsEntry` — Not in pm-adapter converter registry (LOW impact)

The hypothesis says these are "Handled, not rendered" with "Extension renders hidden DOM; I found no pm-adapter render path." This is **correct**:

- `indexEntry` is in `ATOMIC_INLINE_TYPES` (constants.ts:109) for position tracking only.
- Neither `indexEntry` nor `tableOfContentsEntry` appear in `INLINE_CONVERTERS_REGISTRY` (paragraph.ts:856-920).
- Both have PM extensions that render with `display: none` or hidden DOM.

**Hard-gate impact:** None — these are metadata markers, not visible content. The hypothesis is correct.

### 7. Comment rendering mechanism — Hypothesis correct (LOW impact)

The hypothesis correctly identifies that comment visibility comes from marks on runs, not from painting `commentRangeStart`/`commentRangeEnd` nodes:

- Zero grep hits for `commentRangeStart`, `commentRangeEnd`, or `commentReference` in pm-adapter.
- Comment marks (`commentMark`, `comment`) are processed in `marks/application.ts:884-891` via `pushCommentAnnotation()` (lines 257-278).
- DomPainter reads `textRun.comments` array and applies highlight colors (renderer.ts:4678-4709).

**Hard-gate impact:** None — comments ARE visually represented, just not via the range nodes. The rendering-analysis correctly excludes `commentRangeStart/End` from visible element tracking.

### 8. `txbxContent` — Hypothesis correct (LOW impact)

The hypothesis says txbxContent is not a standalone render bucket and only renders when attached to a shape/textbox path. This is **correct**:

- `txbxContent` is classified as `text-box` in rendering-analysis (visible-item-classifier.ts:12).
- In SuperDoc, textbox content renders through `shapeTextbox` → `shapeTextboxNodeToDrawingBlock` (SHAPE_CONVERTERS_REGISTRY, paragraph.ts:935) → DomPainter `vectorShape` path.
- The content inside the textbox flows through the normal paragraph conversion pipeline.

**Hard-gate impact:** LOW. Textbox content should be classified as **supported** when it's inside a recognized shape container.

---

## Verification Matrix

### Directly rendered or laid out

| Node / family | Final classification | Import | Export | pm-adapter | layout-bridge | DomPainter | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|
| `paragraph` | **Rendered** | Yes | Yes | Yes — `handleParagraphNode` (internal.ts:66) | Yes — `ParagraphBlock` handled in `buildFootnoteRanges` (incrementalLayout.ts:433) | Yes — `renderParagraphFragment()` (renderer.ts:2687) | Fully verified | Core content node |
| Heading paragraphs | **Rendered** (style-driven) | Yes | Yes | Yes — same path as paragraph | Yes | Yes | Headings are paragraphs with heading styles | No separate PM node |
| `run`, `text` | **Rendered** | Yes | Yes | Yes — `runNodeChildrenToRuns` (paragraph.ts:867), `textNodeToRun` (paragraph.ts:863) | N/A (inline) | Yes — `renderRun()` (renderer.ts:4615) | Fully verified | |
| Lists / numbering | **Rendered** | Yes | Yes | Yes — paragraph conversion emits `ListBlock` | Yes — `buildFootnoteRanges` handles `list` kind (incrementalLayout.ts:449) | Yes — `renderListItemFragment()` (renderer.ts:2687) | Fully verified | |
| `table` | **Rendered** | Yes | Yes | Yes — `handleTableNode` (internal.ts:74) → `TableBlock` | Yes — handled in `buildFootnoteRanges` (incrementalLayout.ts:470) | Yes — `renderTableFragment()` (renderer.ts:2687) | Fully verified | |
| `image` | **Rendered** | Yes | Yes | Yes — `handleImageNode` (internal.ts:75) block, `imageNodeToRun` (paragraph.ts:902) inline | Yes — `ImageBlock` (incrementalLayout.ts:478) | Yes — `renderImageFragment()` (renderer.ts:2687) | Fully verified | Both inline and floating |
| `vectorShape` | **Rendered** | Yes | Yes | Yes — `vectorShapeNodeToDrawingBlock` (paragraph.ts:932) | Yes — via `DrawingBlock` (incrementalLayout.ts:486) | Yes — `createVectorShapeElement()` (renderer.ts:3518) | Fully verified | |
| `shapeGroup` | **Rendered** | Yes | Yes | Yes — `shapeGroupNodeToDrawingBlock` (paragraph.ts:933) | Yes — via `DrawingBlock` | Yes — `createShapeGroupElement()` (renderer.ts:3521) | Fully verified | |
| `shapeContainer` | **Rendered** | Yes (via pict) | Yes | Yes — `shapeContainerNodeToDrawingBlock` (paragraph.ts:934) | Yes — via `DrawingBlock` | Yes — via vector shape path | Fully verified | VML import → DrawingBlock |
| `shapeTextbox` | **Rendered** | Yes (via pict) | Yes | Yes — `shapeTextboxNodeToDrawingBlock` (paragraph.ts:935) | Yes — via `DrawingBlock` | Yes — via vector shape path | Fully verified | Text content flows through paragraph pipeline |
| `chart` | **Rendered** | Yes (via handleChartDrawing) | Yes | Yes — `chartNodeToDrawingBlock` (paragraph.ts:936) | Yes — via `DrawingBlock` | Yes — `createChartElement()` (renderer.ts:3524) → chart-renderer.ts | Fully verified | 10+ chart types; unsupported types get placeholder |
| `contentBlock` with `horizontalRule` | **Rendered** | Yes | Yes | Yes — `inlineContentBlockConverter` (paragraph.ts:906) returns `DrawingBlock` when HR | Yes — via `DrawingBlock` | Yes — via drawing path | Verified | Only renders when `horizontalRule` attr is present |
| `tab` | **Rendered** | Yes | Yes | Yes — `tabNodeToRun` (paragraph.ts:899) → `TabRun` | N/A (inline) | Partial — tab leaders rendered (renderer.ts:5349-5378) | Verified | |
| `lineBreak`, `hardBreak` | **Rendered as layout effect** | Yes | Yes | Yes — `lineBreakNodeToRun` (paragraph.ts:910,913) inline; `lineBreakNodeToBreakBlock` block | Yes — page/column breaks handled | No standalone DOM element | Verified | Hypothesis correct |
| Page/column breaks | **Rendered as layout effect** | Yes | Yes | Yes — break block conversion | Yes — `PageBreakBlock`/`ColumnBreakBlock` (incrementalLayout.ts:819) | No standalone DOM element | Verified | |
| `fieldAnnotation` | **Rendered** | Yes | Yes | Yes — `fieldAnnotationNodeToRun` (paragraph.ts:875) → `FieldAnnotationRun` | N/A (inline) | Yes — `renderFieldAnnotationRun()` (renderer.ts:4615) | Fully verified | |
| `page-number`, `total-page-number` | **Rendered** | Yes | Yes | Yes — `tokenNodeToRun` (paragraph.ts:922-925) → `TextRun` with token | N/A (inline) | Yes — token replaced at paint time | Verified | |
| `pageReference` | **Rendered** | Yes | Yes | Yes — `pageReferenceNodeToBlock` (paragraph.ts:878) | N/A (inline) | Yes — as text run | Verified | Bookmark-resolved page number |
| `crossReference` | **Rendered** | Yes | Yes | Yes — `crossReferenceNodeToRun` (paragraph.ts:882), returns null if no resolved text | N/A (inline) | Yes — as text run | Verified | |
| `sequenceField` | **Rendered** | Yes | Yes | Yes — `sequenceFieldNodeToRun` (paragraph.ts:884) | N/A (inline) | Yes — as text run | Verified | |
| `documentStatField` | **Rendered** | Yes | Yes | Yes — `documentStatFieldNodeToRun` (paragraph.ts:887) | N/A (inline) | Yes — as text run | Verified | |
| `citation` | **Rendered** | Yes | Yes | Yes — `citationNodeToRun` (paragraph.ts:890) | N/A (inline) | Yes — as text run | Verified | Resolves to display text |
| `footnoteReference` | **Rendered** | Yes | Yes | Yes — `footnoteReferenceToBlock` (paragraph.ts:857) → superscript TextRun | N/A (inline) | Yes — as text run | Fully verified | |
| `endnoteReference` | **Rendered** (reference only) | Yes | Yes | Yes — `endnoteReferenceToBlock` (paragraph.ts:860) → superscript TextRun | N/A (inline) | Yes — as text run | Verified | Reference renders; body does NOT |

### Wrapper/container nodes

| Node / family | Final classification | Import | Export | pm-adapter | layout-bridge | DomPainter | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|
| `structuredContent` | **Wrapper-only** | Yes | Yes | Yes — `structuredContentNodeToBlocks` (paragraph.ts:871) | N/A (children flow through) | SDT metadata applied (renderer.ts:6259-6292) | Verified | Children render; SDT metadata carried |
| `structuredContentBlock` | **Wrapper-only** | Yes | Yes | Yes — `handleStructuredContentBlockNode` (internal.ts:70) | N/A (children flow through) | SDT metadata applied | Verified | |
| `tableOfContents` | **Wrapper-only** | Yes | Yes | Yes — `handleTableOfContentsNode` (internal.ts:67) | N/A (children flow through) | Children render as paragraphs with `isTocEntry` | Verified | |
| `index` | **Wrapper-only** | Yes | Yes | Yes — `handleIndexNode` (internal.ts:68) | N/A | Children render as paragraphs | Verified | |
| `documentSection` | **Wrapper-only** | Yes | Yes | Yes — `handleDocumentSectionNode` (internal.ts:71) | N/A | Children render with SDT metadata | Verified | |
| `bibliography` | **Wrapper-only** | Yes | Yes | Yes — `handleBibliographyNode` (internal.ts:77) | N/A | Children render as paragraphs | Verified | |
| `tableOfAuthorities` | **Wrapper-only** | Yes | Yes | Yes — `handleTableOfAuthoritiesNode` (internal.ts:78) | N/A | Children render as paragraphs | Verified | |
| `documentPartObject` | **Partial wrapper-only** | Yes | Yes | Yes — `handleDocumentPartObjectNode` (internal.ts:76); TOC gallery special-cased (document-part-object.ts:43) | N/A | Children render; non-TOC galleries only process paragraph children | Verified | Hypothesis correct: not full coverage |

### Handled but not rendered

| Node / family | Final classification | Import | Export | pm-adapter | Evidence | Notes |
|---|---|---|---|---|---|---|
| `authorityEntry` | **Handled, not rendered** | Yes | Yes | Registered but returns `null` (authority-entry.ts:10) | `INLINE_CONVERTERS_REGISTRY` entry at paragraph.ts:893; implementation returns null | Hidden TA field marker |
| `indexEntry` | **Handled, not rendered** | Yes | Yes | Not in `INLINE_CONVERTERS_REGISTRY`; in `ATOMIC_INLINE_TYPES` (constants.ts:109) | Extension renders hidden DOM | Position-tracked only |
| `tableOfContentsEntry` | **Handled, not rendered** | Yes | Yes | Not in `INLINE_CONVERTERS_REGISTRY` | Extension renders hidden DOM | Same as indexEntry |
| `bookmarkStart` | **Handled, not rendered** | Yes | Yes | Registered in `INLINE_CONVERTERS_REGISTRY` (paragraph.ts:896) but returns void; tracks positions only (bookmark-start.ts:11) | Side effect: populates bookmarks map | Metadata for cross-references |
| `bookmarkEnd` | **Handled, not rendered** | Yes | Yes | In `ATOMIC_INLINE_TYPES` (constants.ts:113); no converter | Extension renders hidden DOM | Round-trip fidelity |
| `commentRangeStart` | **Handled, not rendered** | Yes | Yes | No converter (zero grep hits in pm-adapter) | Comment visibility via marks (marks/application.ts:884-891) | Marker node only |
| `commentRangeEnd` | **Handled, not rendered** | Yes | Yes | No converter | Same as above | Marker node only |
| `commentReference` | **Handled, not rendered** | Yes | Yes | No converter | Same as above | Marker node only |
| `permStart` | **Handled, not rendered** | Yes | Yes | No converter in pm-adapter | Extension exists for editing | Hidden permission marker |
| `permEnd` | **Handled, not rendered** | Yes | Yes | No converter in pm-adapter | Extension exists for editing | Hidden permission marker |
| `permStartBlock` | **Handled, not rendered** | Yes | Yes | No converter | Block variant of permStart | |
| `permEndBlock` | **Handled, not rendered** | Yes | Yes | No converter | Block variant of permEnd | |
| `passthroughInline` | **Handled, not rendered** | Yes | Yes | In `ATOMIC_INLINE_TYPES` (constants.ts:112) for position tracking; no converter | Extension: `display: none` (passthrough.js:12) | Round-trip preservation only |
| `passthroughBlock` | **Handled, not rendered** | Yes | Yes | Not in `nodeHandlers` (internal.ts:66-82); silently dropped | Extension: `display: none` | Round-trip preservation only |

---

## False Positives

Claims in the hypothesis that overstate rendering support.

**None found.** The hypothesis is conservative and accurate in its claims. All "Rendered" classifications were verified to have complete pipeline support from import through DomPainter.

---

## False Negatives

Things the hypothesis missed that actually do render.

### 1. `endnoteReference` — body context missing from "Directly rendered" section

The hypothesis correctly lists `endnoteReference` as rendered (superscript in body text), but the table entry at line 45 could mislead readers into thinking endnote content is fully supported. The hypothesis does note the endnote body gap in the special cases section (line 90-91), so this is more of a presentation concern than a factual error.

### 2. No missed rendered nodes

All nodes with render paths were correctly identified. No false negatives of significance.

---

## Hard Gate Implications

### For `../rendering-analysis` source inventory

The hard gate should use the following classifications when determining whether a detected element is expected to render in SuperDoc:

#### Elements that can be safely counted as rendered:
- **Paragraphs, text, runs** — fully supported
- **Tables** — fully supported
- **Inline and floating images** — fully supported
- **Vector shapes, shape groups, shape containers, shape textboxes** — fully supported (import via both `w:drawing` and `w:pict` paths)
- **Charts** — supported for 10+ chart types; unsupported types get labeled placeholder
- **Tabs, field annotations, page numbers, page references, cross-references, sequence fields, document stat fields, citations** — fully supported as inline content
- **Footnote references** — rendered as superscript in body text
- **Footnote bodies** — rendered via FootnotesBuilder pipeline
- **Content blocks (horizontal rules)** — rendered when `horizontalRule` attribute is present

#### Elements that should NOT be counted as rendered:
- **`authorityEntry`** — returns null from pm-adapter; invisible
- **`indexEntry`, `tableOfContentsEntry`** — no pm-adapter converter; invisible
- **Bookmarks** — structural metadata; no visual output
- **Comment range markers** — structural; comment visibility comes from marks on runs
- **Permission markers** — no visual output in presentation mode
- **Passthrough nodes** — `display: none`; round-trip only

#### Elements with partial support (gate should flag for review):
- **Endnote references** — reference superscript renders, but body content is absent
- **`documentPartObject`** — only TOC galleries are fully handled; other gallery types only render child paragraphs

#### Elements that are unsupported (gate should flag as missing):
- **Office Math (`oMath`, `oMathPara`)** — passthrough only; completely invisible
- **OLE objects (`w:object`)** — passthrough only; completely invisible
- **Endnote bodies** — no EndnotesBuilder equivalent; content never reaches layout

---

## Source Inventory Bucket Mapping

Mapping `rendering-analysis` source inventory kinds (from `visible-item-classifier.ts:8-18`) to SuperDoc support status.

| Source inventory kind | SuperDoc status | Classification | Evidence |
|---|---|---|---|
| `drawing` | **Supported** | Images, shapes, shape groups, charts all have full render pipelines. Only unusual drawings without `wp:anchor`/`wp:inline` fall to passthrough. | pm-adapter SHAPE_CONVERTERS_REGISTRY (paragraph.ts:928-937); DomPainter drawing dispatcher (renderer.ts:3506-3527) |
| `pict` | **Supported** | VML images, shape containers, shape textboxes, content blocks (HR) all import and render via drawing/shape paths. | pict-translator.js produces shapeContainer/shapeTextbox/image/contentBlock nodes; all have pm-adapter converters |
| `object` | **Unsupported** | No handler for `w:object`. Falls through to passthrough (`display: none`). No pm-adapter converter. | Zero grep hits for `w:object` in converter handlers; passthroughNodeImporter.js catches unregistered elements |
| `text-box` (`txbxContent`) | **Supported** (contextual) | Not standalone — renders only when inside a recognized shape container (`shapeTextbox`). Content flows through paragraph conversion. | shapeTextboxNodeToDrawingBlock in SHAPE_CONVERTERS_REGISTRY (paragraph.ts:935) |
| `equation` (`oMath`, `oMathPara`) | **Unsupported** | `oMath` has boolean-only handler; `oMathPara` falls to passthrough. Neither produces FlowBlocks. No pm-adapter converter, no DomPainter handler. | oMath-translator.js:9 uses `createSingleBooleanPropertyHandler`; constants.ts:112 lists `passthroughInline` in ATOMIC_INLINE_TYPES (position tracking only) |
| `tbl` (table) | **Supported** | Full render pipeline: import → `TableBlock` → layout → DomPainter table fragment. | handleTableNode (internal.ts:74); renderTableFragment (renderer.ts:2687) |
| `footnote-reference` | **Supported** | Reference renders as superscript; footnote body content renders via FootnotesBuilder. | footnoteReferenceToBlock (paragraph.ts:857); FootnotesBuilder.ts:76-144; layout-bridge footnotesInput |
| `endnote-reference` | **Partial** | Reference renders as superscript in body text. Endnote body content does NOT render — no EndnotesBuilder, no layout-bridge endnotesInput. | endnoteReferenceToBlock (paragraph.ts:860); PresentationEditor.ts:4050-4075 computes numbering but no body layout |
| `page-number-field` (`pgNum`) | **Supported** | Rendered via page-number token runs when in supported paths (header/footer/body). | TOKEN_INLINE_TYPES map (constants.ts:121-122); tokenNodeToRun (paragraph.ts:922-925) |

### Key corrections for the hard gate:

1. **`equation` must be `unsupported`**, not `uncertain`. There is zero rendering infrastructure.
2. **`object` must be `unsupported`**, not `uncertain`. No handler exists.
3. **`endnote-reference` must be `partial`**, not `supported`. The reference renders but bodies do not.
4. **`drawing` should be `supported`** (not just "often renderable") — the import path is robust for standard `wp:anchor`/`wp:inline` wrappers.
5. **`pict` should be `supported`** (not just "often renderable") — VML import covers the common shape/image/textbox/HR cases.
6. **`text-box` should be `supported`** with the caveat that it's contextual on the parent shape being recognized.

---

## Verification Methodology

For each claim, the verification traced the path:

```
super-converter import handler → PM node/schema → pm-adapter INLINE_CONVERTERS_REGISTRY
  or nodeHandlers or SHAPE_CONVERTERS_REGISTRY → FlowBlock type → layout-bridge handling
  → DomPainter renderFragment() dispatch → visual output
```

Key files examined:
- `pm-adapter/src/internal.ts` — nodeHandlers dispatch (lines 66-82)
- `pm-adapter/src/converters/paragraph.ts` — INLINE_CONVERTERS_REGISTRY (lines 856-920), SHAPE_CONVERTERS_REGISTRY (lines 928-937)
- `pm-adapter/src/constants.ts` — ATOMIC_INLINE_TYPES (lines 103-116), TOKEN_INLINE_TYPES (lines 121-124)
- `pm-adapter/src/converters/inline-converters/authority-entry.ts` — returns null (line 10)
- `pm-adapter/src/converters/inline-converters/footnote-reference.ts` — returns TextRun (line 24)
- `pm-adapter/src/converters/inline-converters/endnote-reference.ts` — returns TextRun (line 23)
- `pm-adapter/src/converters/inline-converters/bookmark-start.ts` — returns void (line 11)
- `pm-adapter/src/marks/application.ts` — comment mark processing (lines 257-278, 884-891)
- `painters/dom/src/renderer.ts` — fragment dispatch (lines 2687-2708), drawing dispatch (lines 3506-3527), run dispatch (lines 4615-4714), comment highlights (lines 4678-4709)
- `painters/dom/src/chart-renderer.ts` — chart type dispatch (lines 66-97)
- `layout-bridge/src/incrementalLayout.ts` — block type handling, footnotesInput
- `super-editor/src/core/presentation-editor/layout/FootnotesBuilder.ts` — footnote body rendering (lines 76-144)
- `super-editor/src/core/presentation-editor/PresentationEditor.ts` — endnote numbering without body rendering (lines 4050-4075)
- `super-converter/v3/handlers/w/oMath/oMath-translator.js` — boolean property only (line 9)
- `super-converter/v3/handlers/w/drawing/drawing-translator.js` — passthrough fallback (lines 40-47)
- `super-converter/v3/handlers/wp/helpers/encode-image-node-helpers.js` — chart import (line 946)
- `super-converter/v3/handlers/wp/helpers/chart-helpers.js` — chart XML parsing
- `super-editor/src/extensions/passthrough/passthrough.js` — display: none (line 12)
- `rendering-analysis/missing-elements-gate/src/source-inventory/visible-item-classifier.ts` — inventory bucket definitions (lines 8-18)
