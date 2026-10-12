# Ballina Move · Cross-branch integration CI (2026-10-12)

**Offline-only, not for passengers.** This tree combines the exact committed blobs of the following branches without modifying them or main.

- A11 workflow and explicit-date validation: `fix/a11-explicit-service-date` @ `8aa2d6fdf70e97af51388945157e2ae16c3586e1`.
- A12 engine, bugfix PR #15 and performance PR #16: `perf/a12-skip-unreachable-terminal-round` @ `1c4f52f88a129b005bf188fa02266212c2d5fa57`.
- A13 import/gateway bounds: `fix/a13-importer-boundaries` @ `2c46e1db3d2e8fd94a966eaa6184a27e828e2554`.
- Web fixture-only UI: `feature/ballina-web-fixtures` @ `9fdbd8bb7da155b74aceaa9450a7b48f91dc4031`.

The shared log path `docs/ENGINEERING_EXECUTION_LOG.md` comes from the web branch, which includes prior A12/A13 context. The A12/A13 logs are independently retained as `docs/integration/*_ENGINEERING_EXECUTION_LOG.md` to avoid discarding evidence.

## GitHub verification scope
Routing full tests, type checking, generated 16-module artifact byte parity and sealed staging; Python importer and gateway tests; React production build, Playwright desktop/mobile and static-server boundary. These tests are intentionally offline with fixtures/mocks.

## What remains unproved
No auth-gateway live validation, paid GTFS + Stadia trip, provider spend authorization, fresh production GTFS verification, physical sidewalk/boarding safety, real Mayo serverless CPU/memory benchmark, accessible "Abrir em" preview, WCAG/GDPR certification or public passenger readiness.

Do not merge to main, deploy, enable GTFS automation or use any billable provider without explicit authorization. The A12 CPU/RSS regression remains an explicit performance-release gate.

## Follow-up verified October 12

PR #18 (`b1d9dfdc65c99cc528458621c62ad5cedd010ec4`) also includes the exact canary body bounds from `fix/a13-canary-body-bounds` @ `2b1cad2`. GitHub API confirms this PR is open/draft and main remains `4c40f4a`. Routing checks succeeded on b1d9dfd; importer and web were then explicitly dispatched on this same SHA and all their job steps completed successfully (runs38278310166 and38278322806). Logs download is blocked at the Actions results host; no remote test counts are inferred from unavailable logs.

Local b1d9dfd:418 routing,46 Python plus strict gateway types/old API mocks/11 body bounds,11 sealed staging,16-module parity and canary parity passed. Web build passed; full browser run had59 passes/one desktop navigation timeout; unchanged focused desktop/mobile recheck passed2/2. Static preview passed1/1. This failure remains recorded, rather than being reported as a clean60-test local run.

`fix/a13-canary-scenario-type` follows PR #18 and rejects non-string scenario IDs before `Object.hasOwn`. Previous parser accepted a one-element array and threw for an object with null primitive-conversion properties. Six regressions: two failed/four passed before, all six pass after; zero limiter, snapshot and routing calls. Full routing424/424 passed after deterministic canary generation, canonical prefix16/16 unchanged. Independent read-only review approved the guard and test coverage. A deleted-guard mutant is detected. The first regeneration command omitted the required --build flag and left one expected artifact-drift failure; corrected generation and full green run are retained separately. No authenticated/live/paid validation is claimed.
