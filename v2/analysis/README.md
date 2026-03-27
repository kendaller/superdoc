# `@superdoc/v2-analysis`

Analysis and corpus-auditing package for the `v2` document foundation.

This package exists so analysis logic can evolve alongside `v2/model` without
being mixed into the core document model package.

## Role in the `v2` Stack

`v2/analysis` is not the source of truth for documents.

The source of truth remains the OOXML package and, over time, the semantic
entity layer built in `v2/model`.

`v2/analysis` is the place for analysis consumers and analysis artifacts:

- raw OOXML/package scans
- semantic occurrence emission
- capability/support accounting
- corpus summaries
- render-correctness joins

Dependency direction should remain:

- `v2/analysis` may depend on `@superdoc/v2-model`
- `@superdoc/v2-model` must never depend on `v2/analysis`

## Current Scope: Layer 0 Raw Surface

The implemented analysis layer today is the **raw surface** scanner.

Its purpose is to answer:

- what parts exist in a `.docx`
- what raw XML elements/attributes/comments/PIs appear
- where they appear
- how often they appear per document and across a corpus
- what relationships exist in the package

It is intentionally low-interpretation. It records what the source says, not
what the source means semantically.

## Current Public API

Package entry point:

- `src/index.ts`

Current top-level functions:

- `scanRawSurface(input, docId?)`
- `scanRawSurfaceCorpus(inputs, options?)`

These expose the Layer 0 scanner in programmatic form.

## Current Raw-Surface Outputs

The raw-surface layer currently produces these logical outputs:

- package index
- raw facts
- per-document raw summary
- corpus summary
- signature matrix
- examples by signature

The current fact model includes:

- package part classification
- path signatures
- qualified names
- normalized values
- source references
- relationship records
- markup-compatibility context for `mc:AlternateContent`

This is the right level for "what is in the source package?" before semantic
meaning is applied.

## Analysis Universe

For analysis work, the raw-surface results over the agreed corpus define the
current **analysis universe**.

That means:

- downstream analysis does **not** start from unbounded "all OOXML"
- it starts from "what raw-surface actually found in this corpus"
- features absent from the corpus are out of scope for current analysis-driven
  rendering/correctness questions
- adding documents to the corpus can expand the universe

This is intentionally different from the `v2/model` goal.

- `v2/model` aims for comprehensive OOXML preservation
- `v2/analysis` uses the corpus-derived raw-surface output to define what the
  team currently cares about in analysis

The recommended artifact for this boundary is the corpus-level output from the
raw-surface scanner:

- corpus summary
- signature matrix
- examples by signature
- future corpus feature matrix / universe manifest

Later analysis layers should treat that artifact as the default scope boundary
for:

- semantic occurrences
- capability/support accounting
- rendering-gap work
- correctness joins

## Current Directory Layout

```text
src/
  cli/                Thin analysis CLIs
  raw-surface/        Layer 0 raw OOXML/package scanning
test/
  helpers/            Fixture builders
  raw-surface/        Raw-surface tests
output/               Local generated artifacts / scratch output
```

## What Belongs Here

Good fits:

- raw OOXML/package inventories
- semantic occurrence emission
- support/capability accounting
- corpus aggregation and diff tooling
- correctness reporting and joins

Not good fits:

- package open/save substrate
- primitive mutation logic
- semantic edit operations
- layout projection code

Those belong in `v2/model` or downstream product packages.

## Planned Analysis Layers

The intended progression is:

1. **Layer 0: Raw surface**
   Present today. Low-interpretation package and XML audit data.
2. **Layer 1: Semantic occurrences**
   Occurrences emitted from semantic entities and source refs.
3. **Layer 2: Capability / coverage**
   Join occurrences against current SuperDoc and `v2/model` support status.
4. **Layer 3: Correctness**
   Join source/semantic occurrences to layout and render results.

This keeps "what exists", "what we support", and "what renders correctly" as
separate but connected layers.

## Relationship to Planning Docs

Cross-cutting product and architecture decisions should not live only in this
package.

Use these docs together:

- `plans/v2-index.md`
  Cross-workstream entry point and decision summary.
- `plans/semantic-model.md`
  Canonical architecture plan for the future model stack.
- `plans/analysis-universe.md`
  Canonical plan for the corpus-bounded analysis universe, its artifacts, and
  the separation between raw-surface, universe, and support-matrix layers.
- `plans/corpus-discussion.md`
  Earlier discussion of corpus analysis goals, occurrence modeling, and why
  analysis should come from the same model stack.

## Current Notes

- The raw-surface layer already covers important source concerns such as
  relationships, malformed XML handling, deterministic output, `customXml`,
  and `AlternateContent`.
- Generated artifacts should remain outside `src/`.
- Canonical outputs should remain deterministic and free of machine-local
  paths wherever possible.
