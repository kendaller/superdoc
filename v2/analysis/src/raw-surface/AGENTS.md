# Raw Surface

Layer 0 raw OOXML/package audit scanner.

This directory is the trust anchor for higher analysis. Its job is to answer:

- what raw package/XML surface exists
- where it exists
- how often it exists

It is not the semantic model and it is not the renderer.

## Hard Boundary

Code in `src/raw-surface/` must remain independent from `@superdoc/v2-model`.

Do not import from:

- `v2/model`
- semantic entity code
- layout projection code
- rendering-analysis code that assumes semantic meaning

This scanner must remain useful even if the semantic model is incomplete or
wrong.

## What This Layer Is Allowed To Do

- open `.docx` ZIPs
- classify package parts
- parse XML mechanically
- emit raw syntax facts
- record exact evidence paths and diagnostics
- build deterministic summaries and corpus rollups
- extract fixed-schema OPC relationship triples

## What This Layer Must Not Do

- infer Word semantics
- decide whether SuperDoc “supports” a feature
- resolve styles, numbering, or fields
- flatten source into semantic concepts
- hide raw patterns because they are currently unsupported

If in doubt, prefer recording source evidence over interpretation.

## Key Invariants

1. No silent omission. Unknown namespaces, unfamiliar parts, and unsupported
   structures should still surface in facts or diagnostics.
2. Deterministic output. The same input bytes should produce the same facts and
   summaries.
3. Evidence-first records. Every fact needs an exact source path.
4. Grouping and evidence are separate. `pathSignature` is for aggregation;
   `xpathLikePath` is for exact source identity.
5. Keep normalization conservative. Structural classification is fine;
   OOXML-aware semantic interpretation is not.

## Important Files

| File | Responsibility |
|---|---|
| `api.ts` | Public single-doc / corpus entry points |
| `open-docx.ts` | ZIP entry loading |
| `part-selection.ts` | XML vs binary selection |
| `part-classification.ts` | Stable part-kind mapping |
| `xml-bytes.ts` | Encoding detection and XML byte decoding |
| `xml-event-scan.ts` | SAX traversal and fact emission |
| `path-state.ts` | Stable path and sibling indexing |
| `fact-emitter.ts` | `RawSurfaceFact` creation |
| `relationship-extractor.ts` | Mechanical `.rels` extraction |
| `summarize-doc.ts` | Per-document rollups |
| `summarize-corpus.ts` | Corpus rollups and signature matrix |
| `write-artifacts.ts` | Deterministic artifact writing |

## Testing Expectations

Any change here should usually add or update tests covering:

- deterministic ordering
- path/index generation
- encoding handling
- namespace handling
- `mc:AlternateContent` handling
- malformed XML diagnostics
- output layout behavior if artifact writing changes

Run:

```bash
pnpm --filter @superdoc/v2-analysis test
pnpm --filter @superdoc/v2-analysis typecheck
```

## Design Bias

When choosing between:

- a simpler mechanical scan that is obviously correct
- a smarter interpretation that guesses intent

choose the mechanical scan.

The whole point of this directory is to be the low-level layer higher systems
can audit against.
