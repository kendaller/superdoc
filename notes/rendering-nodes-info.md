# Rendering Nodes Catalogue

## Scope

- This is a support catalogue, not a quality/correctness catalogue.
- "Rendered" means there is a concrete path from imported PM content through `pm-adapter` into `layout-engine` and `DomPainter`, or the node causes a visible layout effect even if it does not get its own DOM element.
- "Wrapper-only" means the node itself is not a visible object, but its children are traversed and rendered.
- "Handled but not rendered" means import/export and schema support exist, but presentation rendering does not paint a visible object for that node.

## Render boundary used here

The effective visual pipeline is:

`PM doc -> pm-adapter -> FlowBlock[] / Run[] / DrawingBlock -> layout-bridge -> DomPainter`

For this note, a node only counts as rendered if it reaches one of the DomPainter fragment/run/drawing paths or an equivalent layout-only path such as footnotes or page/column breaks.

## Directly rendered or laid out

| Node / family | Status | How it renders |
|---|---|---|
| `paragraph` | Rendered | Converted to paragraph/list blocks and painted as `para` or `list-item` fragments. |
| Heading paragraphs | Rendered | Same render path as normal paragraphs; heading-ness is style-driven, not a separate painter node. |
| `run`, `text` | Rendered | Painted as inline text spans; hyperlink-marked runs become anchors. |
| Lists / numbering | Rendered | Paragraph conversion emits list blocks; DomPainter paints list items and markers. |
| `table` | Rendered | Converted to `TableBlock`; table cells can contain paragraphs, images, and drawings. |
| `image` | Rendered | Supported both inline and block/floating; `pm-adapter` emits inline image runs or image blocks. |
| `vectorShape` | Rendered | Converted to `DrawingBlock` with `drawingKind: 'vectorShape'`; DomPainter renders SVG/shape content. |
| `shapeGroup` | Rendered | Converted to `DrawingBlock` with `drawingKind: 'shapeGroup'`; DomPainter renders grouped child shapes/images. |
| `shapeContainer` | Rendered | Converted to a drawing block and ultimately painted as vector-shape content. |
| `shapeTextbox` | Rendered | Converted to a drawing block with preserved text content; painted via vector-shape path. |
| `chart` | Rendered | Converted to `DrawingBlock` with `drawingKind: 'chart'`; DomPainter delegates to `chart-renderer.ts` which supports bar/line/stock/area/scatter/bubble/radar/pie/doughnut/ofPie types. Unsupported chart types get a labeled placeholder. Import path: `handleChartDrawing()` in `encode-image-node-helpers.js` parses chart XML from cached values. |
| `contentBlock` with `horizontalRule` | Rendered | Converted to a drawing block and painted as horizontal-rule style VML content. |
| `tab` | Rendered | Converted to `TabRun`; painter creates tab/leader output. |
| `lineBreak`, `hardBreak` | Rendered as layout effect | Inline line breaks affect line layout; break blocks can become page/column breaks. They do not get a standalone visible DOM element. |
| Page and column break effects | Rendered as layout effect | Produced through break-block conversion and pagination/layout logic. |
| `fieldAnnotation` | Rendered | Converted to `FieldAnnotationRun`; DomPainter paints the annotation UI. |
| `page-number`, `total-page-number` | Rendered | Converted to token runs and resolved at paint time. |
| `pageReference` | Rendered | Converted to token/text run with bookmark metadata and fallback text. |
| `crossReference` | Rendered | Converted to visible text run using resolved text. |
| `sequenceField` | Rendered | Converted to visible text run using resolved number. |
| `documentStatField` | Rendered | Converted to visible text run using resolved text. |
| `citation` | Rendered | Converted to visible text run using resolved citation text. |
| `footnoteReference` | Rendered | Converted to visible superscript text run in the main story. |
| `endnoteReference` | Rendered | Converted to visible superscript text run in the main story. |

## Wrapper/container nodes whose children render

These nodes matter to rendering, but mostly as traversal/metadata containers rather than as their own visible objects.

| Node / family | Status | What actually renders |
|---|---|---|
| `structuredContent` | Wrapper-only | No standalone visual object; children render with SDT metadata carried forward. |
| `structuredContentBlock` | Wrapper-only | Child paragraphs and tables render; wrapper contributes SDT metadata. |
| `tableOfContents` | Wrapper-only | Child paragraphs render as normal paragraphs, tagged as TOC entries. |
| `index` | Wrapper-only | Child paragraphs render as normal flow blocks. |
| `documentSection` | Wrapper-only | Child paragraphs, tables, images, and nested structured content are traversed and rendered. |
| `bibliography` | Wrapper-only | Child paragraphs render as normal flow blocks. |
| `tableOfAuthorities` | Wrapper-only | Child paragraphs render as normal flow blocks. |
| `documentPartObject` | Partial wrapper-only | TOC galleries get special traversal. Non-TOC galleries only render child paragraphs; non-paragraph children are not broadly traversed here. |

## Handled in import/export but not visually rendered

These are the clearest "round-trip support exists, but no visible presentation rendering" cases.

| Node / family | Status | Why it is not visually rendered |
|---|---|---|
| `authorityEntry` | Handled, not rendered | `pm-adapter` explicitly returns `null`; TA fields are treated as hidden markers. |
| `indexEntry` | Handled, not rendered | Extension renders hidden DOM; I found no `pm-adapter` render path for it. |
| `tableOfContentsEntry` | Handled, not rendered | Extension renders hidden DOM; I found no `pm-adapter` render path for it. |
| `bookmarkStart` | Handled, not rendered | Used to record bookmark positions and traverse wrapped content; no visible artifact of its own. |
| `bookmarkEnd` | Handled, not rendered | Hidden inline atom kept for round-trip/bookmark structure; no visual paint path. |
| `commentRangeStart` | Handled, not rendered | Structural marker only. Comment highlighting is derived from marks/run annotations, not from painting this node. |
| `commentRangeEnd` | Handled, not rendered | Structural marker only. Comment highlighting is derived from marks/run annotations, not from painting this node. |
| `commentReference` | Handled, not rendered | Comment plumbing uses it structurally; no DomPainter path paints it as a visible object. |
| `permStart` | Handled, not rendered | Hidden permission marker; no presentation render path. |
| `permEnd` | Handled, not rendered | Hidden permission marker; no presentation render path. |
| `permStartBlock` | Handled, not rendered | Hidden block permission marker; no presentation render path. |
| `permEndBlock` | Handled, not rendered | Hidden block permission marker; no presentation render path. |
| `passthroughInline` | Handled, not rendered | Unknown inline OOXML preserved for round-trip fidelity; extension renders it hidden. |
| `passthroughBlock` | Handled, not rendered | Unknown block OOXML preserved for round-trip fidelity; extension renders it hidden. |

## Special cases relevant to the hard gate

- Comments are visually represented, but not by painting `commentRangeStart`, `commentRangeEnd`, or `commentReference`.
  The visible output comes from comment annotations attached to text runs in `pm-adapter`, then highlighted in `DomPainter`.
- Tracked changes are also visually represented primarily as run/block metadata, not as standalone PM nodes that the painter dispatches on.
- Footnote bodies do render in presentation mode.
  There is an explicit `FootnotesBuilder` path that converts `converter.footnotes` into layout input, and `layout-bridge` has explicit `footnotesInput` handling.
- Endnote bodies are a **confirmed gap** in presentation rendering.
  `PresentationEditor.ts` computes endnote numbering (lines 4050-4075) but never builds layout input from endnote body content. No `EndnotesBuilder` exists (contrast with `FootnotesBuilder.ts`). No `endnotesInput` parameter in `layout-bridge/incrementalLayout.ts`. Endnote reference superscripts render, but body content is absent.
- `documentPartObject` is only partially supported as a wrapper.
  TOC galleries are handled specially. Other galleries only render child paragraphs, so a hard gate should not assume full doc-part rendering coverage.

## Mapping to `rendering-analysis` source inventory

This is the most useful normalization layer for the hard gate in `../rendering-analysis`.

| Source inventory kind | Status | Outcome in SuperDoc |
|---|---|---|
| `drawing` | **Supported** | Standard `wp:anchor`/`wp:inline` drawings become `image`, `vectorShape`, `shapeGroup`, `chart`, or `contentBlock`, all of which have full painter support. Only non-standard drawings (missing `wp:anchor`/`wp:inline` children) fall to passthrough. |
| `pict` | **Supported** | VML import produces `shapeContainer`, `shapeTextbox`, `image`, or `contentBlock`, all flowing into the drawing/image painter paths. |
| `object` | **Unsupported** | No importer or render path for `w:object` / OLE objects. Falls through to passthrough (`display: none`). |
| `txbxContent` | **Supported** (contextual) | Not a standalone render bucket. Renders only when attached to a recognized shape/textbox path (`shapeTextbox` or vector-shape text content). |
| `oMath` | **Unsupported** | No pm-adapter converter, no FlowBlock type, no DomPainter handler. Falls to passthrough and is invisible. |
| `oMathPara` | **Unsupported** | Same as `oMath`: no handler at all (falls to `passthroughInline`). |
| `tbl` | **Supported** | Rendered through the full table pipeline. |
| `footnoteReference` | **Supported** | Rendered as superscript reference in body text; footnote body content is rendered via `FootnotesBuilder` → layout-bridge `footnotesInput`. |
| `endnoteReference` | **Partial** | Rendered as superscript reference in body text. Endnote body content is **not rendered** — no `EndnotesBuilder` exists, no `endnotesInput` in layout-bridge. |
| `pgNum` | **Supported** | Rendered via page-number token runs. |

## Office Math note (verified)

`w:oMath` and `w:oMathPara` are **confirmed unsupported** for visual rendering:

- `oMath-translator.js` uses `createSingleBooleanPropertyHandler('w:oMath')` — this only stores a boolean flag, not math content.
- `oMathPara` has no handler at all; it falls through `passthroughNodeImporter.js` to become a `passthroughInline` node (confirmed by test: `passthroughNodeImporter.test.js` lines 43-50).
- Both `m:oMath` and `m:oMathPara` are listed in `inlineContext.js` `INLINE_NODE_NAMES`, causing passthrough classification.
- `passthroughInline` is in `ATOMIC_INLINE_TYPES` (constants.ts:112) for position tracking only — no converter in `INLINE_CONVERTERS_REGISTRY`.
- No pm-adapter converter, no FlowBlock type, no DomPainter handler for math.

Office Math content is invisible in presentation mode. It is preserved in the PM document only for round-trip export fidelity.

## Practical hard-gate guidance

- Count these as genuinely render-supported:
  paragraphs, lists, tables, inline/block images, vector shapes, shape groups, VML shapes/textboxes that map into drawing blocks, charts, tabs, page-number tokens, page references, sequence/document-stat/citation/cross-reference text, footnote references, endnote references, TOC/index/bibliography/TOA paragraph content, footnote bodies.
- Count these as handled-but-not-rendered:
  authority entries, index entries, TOC entry markers, bookmarks, comment marker nodes, permission markers, passthrough nodes.
- Count these as confirmed visual gaps:
  Office Math objects (`oMath`/`oMathPara`), OOXML `w:object`/OLE objects, endnote bodies, and non-paragraph/non-TOC `documentPartObject` content.

## Key code references

- `packages/layout-engine/pm-adapter/src/internal.ts`
- `packages/layout-engine/pm-adapter/src/converters/paragraph.ts`
- `packages/layout-engine/pm-adapter/src/converters/inline-converters/authority-entry.ts`
- `packages/layout-engine/pm-adapter/src/converters/inline-converters/bookmark-start.ts`
- `packages/layout-engine/pm-adapter/src/converters/inline-converters/page-reference.ts`
- `packages/layout-engine/pm-adapter/src/sdt/toc.ts`
- `packages/layout-engine/pm-adapter/src/sdt/document-index.ts`
- `packages/layout-engine/pm-adapter/src/sdt/document-section.ts`
- `packages/layout-engine/pm-adapter/src/sdt/document-part-object.ts`
- `packages/layout-engine/pm-adapter/src/sdt/structured-content-block.ts`
- `packages/layout-engine/pm-adapter/src/sdt/bibliography.ts`
- `packages/layout-engine/pm-adapter/src/sdt/table-of-authorities.ts`
- `packages/layout-engine/painters/dom/src/renderer.ts`
- `packages/layout-engine/painters/dom/src/chart-renderer.ts`
- `packages/layout-engine/layout-bridge/src/incrementalLayout.ts`
- `packages/super-editor/src/core/presentation-editor/layout/FootnotesBuilder.ts`
- `packages/super-editor/src/core/super-converter/exporter.js`
- `packages/super-editor/src/extensions/index-entry/index-entry.js`
- `packages/super-editor/src/extensions/table-of-contents-entry/table-of-contents-entry.js`
- `packages/super-editor/src/extensions/authority-entry/authority-entry.js`
- `packages/super-editor/src/extensions/comment/comment.js`
- `packages/super-editor/src/extensions/bookmarks/bookmark-end.js`
- `packages/super-editor/src/extensions/perm-start/perm-start.js`
- `packages/super-editor/src/extensions/perm-end/perm-end.js`
- `packages/super-editor/src/extensions/passthrough/passthrough.js`
