## V2 Editor Surface

This directory is the product-side home for the new `v2/model` pipeline.

Current scope:
- presentation/render integration helpers used by the existing v1 `PresentationEditor`
- v2-specific projection/parity utilities
- focused integration tests for the v2 presentation path

Near-term direction:
- keep the existing v1 editor shell as the host
- move v2-specific runtime wiring here
- add a SuperDoc-level pipeline switch that can choose `legacy` or `v2-static`

Longer-term:
- grow this directory into the real editor-side organization for the v2 pipeline
- reduce v1 ownership of v2-specific boot/render logic over time
