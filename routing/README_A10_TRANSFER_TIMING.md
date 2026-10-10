# Ballina Move A10 | Timetable-aware transfer priority (private candidate)

Base: `main` after A01–A09.1 / merge of PR #4 on 2026-10-10.
Suggested Draft PR branch: `feature/a10-timetable-transfer-hints` -> `main`.

**Not a deployment.** Do not publish routing to passengers or use synthetic walking directions for navigation.

## Confirmed defect

A08 prioritized pairs whose GTFS topology appeared to connect an origin region to a destination region. A09 showed one private Ballina–Castlebar search with **364 geodesically plausible GTFS transfer pairs** and only **4 provider-call slots**. Of these 364, 331 received topology hints, which is too broad to rank scarce calls effectively. None of these counts proves a walkable or timetable-feasible interchange.

## A10 behavior

- Extracts active, service-date-aware **one-transfer** timetable evidence: a reachable first ride alights at stop A, an independent second vehicle boards at B after the optimistic geodesic walking lower bound and the transfer buffer, and reaches a stop near the destination.
- Respects GTFS pickup/drop-off rules, date-specific calendars and the 18-hour first-boarding horizon. A previous service date's `25:xx` departure is interpreted on the requested local day. DST-adjacent rules are inherited from the journey engine.
- Rejects self-transfer evidence from the same GTFS vehicle instance. Actual walking geometry is still required separately by the pedestrian provider.
- Prioritizes timetable-hinted candidates ahead of topology-only candidates. Across geographic cells, visits the best-ranked cells first rather than relying on cell names. For `less_walking`, uses an **optimistic walking-distance lower bound** as the first preference; otherwise uses optimistic arrival time.
- Preserves the original directional A08 geographic round-robin as a **fallback**, including different/same-route priority. No GTFS pair is rejected just because the A10 timing heuristic lacks evidence.
- Keeps existing `maxRequestCount`, `maxTransferPairs` and total passenger walking budget. A10 **does not raise the production cap of 12 walking calls**.
- Adds aggregate-only `candidateAudit.transfers.timetableHinted` and `.selectedTimetableHinted` counters. No coordinates, stop IDs or passenger identity are included in these audit counts.
- Optimizes timed eligibility checks with indexed arrivals and the best two distinct vehicle identities at each stop (rather than repeatedly scanning all inbound rows for each candidate pair).

## Tests and observations

- A10 adds **11** adversarial tests: spatially preferred but impossible connections, deterministic GTFS input order, impossible timing, same-route changes, geographic fallback, hard walking caps, 25:xx day rollover, distinct vehicle evidence, prevention of self-transfer, expired service, and `fastest` versus `less_walking` preferences across geographic cells.
- Local routing checkout: **288/288 tests passed**, no failures (includes A09.1 local checkout and A10).
- Synthetic stress probe: 1,518 trips, 30,360 stop times, 38,878 geodesic candidate pairs. The original A09 code took approximately 0.6 s; optimized A10 ~1.0 s on the same local host, with the same 12-call cap. These numbers are not production benchmarks.
- The exact 16-module artifact was reconstructed while **preserving the 14 non-A10 modules** from the already-reviewed GitHub artifact. Byte-identical independent regeneration succeeded and 16/16 module token equivalence passed.
- A09's test assertions were updated only to account for the two new aggregate audit fields.

## Remaining limits

- Timetable matching is optimistic GTFS-only prioritization. It is **not a guarantee** of actual connection reliability, reachable boarding platforms, sidewalks or live trains/buses.
- Two-transfer-only connections may remain in the fallback tier; one-transfer timing hints do not prove exhaustive search completeness.
- A10 does not remove the origin/destination stop caps, geographic approximations or finite 24-state-per-stop bound in the journey engine.
- The private v6 Supabase staging function was **not changed**. Any live private A10 deployment requires a separate audited step with explicit approval; verify JWT, private token, real feed response, walking budget and candidate diagnostics before considering changes beyond staging.
- The local checkout contained older copies of `httpApi.ts` and `irishRail.ts`; the artifact therefore preserved their exact current, previously approved compiled modules. The official GitHub CI must recompile the fresh checkout and verify both token parity and zero artifact drift. Local 288-test results must not be presented as that CI result.

## Acceptance sequence

1. Upload these 10 project files to **a new branch from `main`**, and open a Draft PR against `main`.
2. Verify GitHub Actions: source compile, pre-regeneration module token equivalence, all routing tests, zero artifact drift after regeneration, wrapper security tests.
3. Investigate any failure. Do not bypass integrity checks to obtain green CI.
4. Review private integration on real Mayo GTFS, especially the A09 Ballina → Castlebar 364/4 case, before any staging deployment.
5. Keep public routing disabled. The next separate workstream is real pedestrian geometry (A11) and end-to-end validation.
