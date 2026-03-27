## V2 Editor Surface

This directory is the product-side home for the new `v2/model` pipeline.

Current scope:
- presentation/render integration helpers used by the existing v1 `PresentationEditor`
- v2-specific projection/parity utilities
- isolated static rendering host for `v2/model -> FlowBlock[] -> layout-engine -> DomPainter`
- focused integration tests for the v2 presentation path

Near-term direction:
- keep v2 runtime code organized here instead of scattering it through v1
- use a temporary `v2-static` SuperDoc pipeline to exercise the full render path
- add a SuperDoc-level pipeline switch that can choose `legacy` or `v2-static`

Longer-term:
- grow this directory into the real editor-side organization for the v2 pipeline
- reduce v1 ownership of v2-specific boot/render logic over time
