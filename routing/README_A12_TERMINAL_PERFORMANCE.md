# A12 terminal-round candidate pruning (performance-only follow-up)

This optimization is based on the separate Draft PR #15 (`fix/a12-pareto-snap-frontier-regression`). It preserves the safety/correctness fix in that PR.

## Invariant

`round=0` means the first ride. `round=maxTransfers` is the **last** permitted ride, so the engine cannot use further transfer frontiers from that round. On that final ride, only alighting stops with an already-validated egress path can yield a complete journey.

Changes:
- Skip building final-round labels at alighting stops with no validated egress.
- Skip recomputing transfer frontiers when there is no later round.
- Preserve the entire timetable search, access, egress, transfer logic and Pareto/24-label rules in earlier rounds.
- Keep walking-provider call caps unchanged; no paid or remote requests, schema changes, or deployments.

## Evidence (scope-limited)

The local reconstructed routing checkout passed its 321 tests plus 2 new direct/double-transfer regressions and the 11 sealed-staging tests. A local differential test compared 180 deterministic synthetic queries across `maxTransfers=0/1/2` and found **identical returned itineraries** before/after this performance-only change.

On a synthetic 1,518-trip / 30,360-stop-time run with only terminal egress stops relevant, a few repeats measured approximately 1.7–1.8 seconds before and 1.0–1.15 seconds after (about 35–40% faster). This test is purpose-built and is **not** a Mayo production benchmark. CPU/RAM real hosting performance remains a P2 release gate. The original Codex benchmark with different synthetic topology must be repeated independently.

Run the official GitHub Actions CI for THIS branch to validate the regenerated 16-module artifact and A11 canary parity. Do not merge into `main` or deploy for passengers without end-to-end review.

This branch is intentionally based on another draft change and should not be merged out of order.
