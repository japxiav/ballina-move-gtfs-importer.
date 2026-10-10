# A09.1 - Stabilization and release gates (offline only)

This patch is based on `fix/a09-candidate-audit` and is for a new **draft** PR only. It does not deploy, alter Supabase, run paid walking requests, or promote `main`.

## Changes

- Compiles the TypeScript source and verifies **the committed artifact** *before* regeneration.
- Regenerates the candidate as a reproducibility check, then rejects any `git diff` in the tracked candidate.
- Keeps the module token check **after** generation as well.
- Adds a negative test that tampers with the walking-request budget in a temporary candidate and requires detection.
- Removes six `package.json` example scripts pointing at the non-existent `examples/` directory. Old README version histories describing these examples are historical only.
- Adds a read-only offline regression for the **exact private staging v6 wrapper suffix** observed on Supabase. Tests JWT-gateway-independent token checks, health, disabled database behavior and synthetic-walking seals. (Supabase gateway JWT still requires live verification.)
- Existing `npm test`, `npm run build`, `npm run verify:artifact`, and `npm run api-local` remain.

## Audit checklist

- Review `README_A091_CHECKUP.md` for the A01-A09 regression matrix and operator gates.
- Optional read-only database integrity check: `scripts/gtfs_health_readonly.sql`. Does not schedule imports.

## Limitations and release blockers

- CI exercises the snapshotted v6 wrapper offline but does **not** prove the live JWT gateway, real Supabase fetches or current deployed bytes are automatically in sync. Those need an authenticated staging acceptance test.
- GTFS import is manual-only. Do not enable unattended daily activation without a separate acceptance review.
- Do not treat synthetic walking as real footpath distances or user navigation.
- Do not change the private staging or production functions as part of this patch.
- The local audit snapshot is incomplete relative to GitHub A09 (missing some A02-A05 tests and outdated `httpApi`/`irishRail`), so **the official CI on the new branch is the definitive integration check**.
