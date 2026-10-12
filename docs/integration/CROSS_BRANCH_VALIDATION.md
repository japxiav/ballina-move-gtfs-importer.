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
