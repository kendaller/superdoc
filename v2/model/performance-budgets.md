# v2/model Performance Budgets

Provisional targets — refined after first measurement pass on benchmark docs.

## Document Classes

| Class | Description |
|-------|-------------|
| `small` | 10-20 pages, common business-doc complexity |
| `medium` | 100 pages, mixed paragraphs/tables/headers/footnotes |
| `large` | 500 pages, representative enterprise document |
| `xlarge` | 5,000+ pages or equivalent synthetic stress case |

## Latency Budgets

| Operation | small | medium | large | xlarge |
|-----------|-------|--------|-------|--------|
| fast open | ≤ 250ms | ≤ 1s | ≤ 3s | lazy (no eager limit) |
| ready("structure") | ≤ 750ms | ≤ 3s | ≤ 8s | lazy |
| FlowBlock[] projection | ≤ 1s | ≤ 4s | ≤ 10s | lazy viewport-scoped |
| no-op save | ≤ 100ms | ≤ 500ms | ≤ 1s | ≤ 3s |
| small edit + save | ≤ 200ms | ≤ 750ms | ≤ 2s | ≤ 5s |
| rebuild() after mutation | ≤ 500ms | ≤ 2s | ≤ 5s | lazy |

## Memory Budgets

| Metric | small/medium | large/xlarge |
|--------|-------------|-------------|
| Memory amplification (model size / file size) | ≤ 5x | ≤ 3x |
| Hydrated regions per projection pass | O(body children) | O(body children) |

## Invalidation Budgets

| Metric | Target |
|--------|--------|
| Invalidation cost after small edit | O(1) entities |
| Full graph rebuild on property-only mutation | NOT required |
| Entities re-extracted after small edit | O(1) |

## Relative Parity Budget

For documents/features already supported by the current PM path, v2/model must not
regress core rendering-preparation latency by more than **20%** on the agreed benchmark
set without explicit signoff.

## Notes

- `xlarge` hard requirement: architecture remains lazy — no eager full hydration for open/enumerate.
- Budgets are planning targets. Actual numbers validated during Phase 3+ with benchmark fixtures.
- No formal benchmark fixture set yet — will be created alongside Phase 3 vertical slice.
