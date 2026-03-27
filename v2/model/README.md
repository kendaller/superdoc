# `@superdoc/v2-model`

This package is the initial transplant of the `superdoc-v2/docx-engine`
substrate into the main SuperDoc monorepo.

Current scope:

- OPC/package open/save infrastructure
- XML lexical indexing and hydration
- package-backed typed views
- primitive XML mutation engine
- runtime helpers and substrate tests

Intentional non-goals for this import:

- redesigning the semantic model
- changing mutation semantics
- replacing layout inputs
- product-facing editor integration

This package is the foundation that future `v2` work will build on. The next
major layer to add is the Word-semantic entity and operation model on top of
this substrate, not a second competing source of truth.
