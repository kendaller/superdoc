# V2 Analysis

Analysis and corpus-auditing workspace for the `v2` document foundation.

This package is where analysis code should live when it is not part of the
core document model itself.

## Package Boundary

`v2/analysis` exists to keep analysis concerns grouped together without mixing
them into `v2/model`.

Dependency direction should remain:

- `v2/analysis` may depend on generic ZIP/XML utilities
- higher-level analysis code in `v2/analysis` may depend on `@superdoc/v2-model`
- `@superdoc/v2-model` must never depend on `v2/analysis`

If a helper is truly generic substrate logic rather than analysis logic, move
it into `v2/model` only when that reuse is clearly justified.

## Subareas

| Area | Purpose |
|---|---|
| `src/raw-surface/` | Layer 0 raw OOXML/package audit scanner |
| `src/cli/` | Thin wrappers around analysis APIs |
| future semantic analysis | Higher-level occurrence / coverage / correctness work |

## What Belongs Here

Good fits for `v2/analysis`:

- corpus scanners
- raw OOXML/package inventories
- semantic occurrence emission
- support/capability accounting
- correctness joins and reporting
- corpus summary and diff tooling

Not good fits:

- package open/save substrate
- primitive XML mutation logic
- semantic edit operations
- layout projection code

Those belong in `v2/model` or downstream consumers.

## Testing

Run package-local checks when changing this area:

```bash
pnpm --filter @superdoc/v2-analysis test
pnpm --filter @superdoc/v2-analysis typecheck
```

Tests should stay close to the analysis surface they exercise:

- low-level scanner/unit tests in `test/raw-surface/`
- corpus aggregation tests near corpus logic
- fixture builders in `test/helpers/`

## Output Artifacts

Generated analysis outputs should be treated as artifacts, not source.

- keep generated files out of `src/`
- prefer writing to explicit output directories
- keep canonical outputs deterministic
- do not bake machine-local absolute paths into canonical artifacts

The current local scratch area is:

- `output/`

Do not build product logic around files that only exist under `output/`.

## Design Rules

- Keep low-level analysis honest. If a pattern is present in source and no
  higher layer explains it, the analysis stack should surface that rather than
  filtering it away.
- Prefer deterministic formats and ordering. Stable diffs matter more here than
  in most product code.
- Keep “raw surface”, “semantic occurrence”, “coverage”, and “correctness” as
  distinct layers even when they live in the same package.

## Entry Points

- Package API: `src/index.ts`
- Raw surface API: `src/raw-surface/index.ts`
- Raw surface CLI: `src/cli/raw-surface.ts`

If you are changing `src/raw-surface/`, also read
[`src/raw-surface/AGENTS.md`](/Users/nickjbernal/dev/superdoc/v2/analysis/src/raw-surface/AGENTS.md).
