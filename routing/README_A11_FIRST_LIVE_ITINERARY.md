# A11 first end-to-end LIVE itinerary: Ballina to Foxford

**Review candidate. Private, manually triggered, no public rollout.**

This workflow is the first live `GTFS active snapshot -> full timetable engine -> real Stadia/Valhalla pedestrian segments -> bus and walking itinerary` test using **the already deployed** `ballina-a11-realwalking-canary` (JWT enabled). The current synthetic v0.10 staging stays untouched.

## Historical GTFS basis (read-only observations on 2026-10-11)

These observations are historical evidence, not proof of service on another date. The runner no longer pins an expired date. Before a separately authorized live run, an operator must review the current GTFS calendar and select a future departure. No paid requests were made to prepare this correction.

- Active feed label: `nta-realtime`; 227 stops, 9 routes, 1,518 trips, 30,115 stop times (validated independently by the 6-GET private canary acceptance).
- Sunday **2026-10-11**, service_id `180`, trip `5940_48615`, bus route `22`:
  - Ballina Bus Station GTFS stop `8490B5550501`, **09:30** departure, pickup allowed.
  - Foxford GTFS stop `8490B141661`, **09:44** arrival, drop-off allowed.
  - The planner searches from **09:15**. These are **scheduled GTFS times**, not real-time.
- The canary's pre-existing fixed `ballina-foxford-bus` coordinates are used; user locations are not accepted.

## Maximum paid consumption and isolation

1. Manual `workflow_dispatch` only, only from reviewed `main`, with deliberate `YES_ONE_ITINERARY_MAX_12_WALKS` choice; default is NO.
2. **Two authenticated GET** preflight checks (`/health` and `/v1/gtfs-summary`). Both must pass before any paid request.
3. **At most ONE** `POST /v1/canary-journey` with a fixed scenario, explicitly reviewed date/time and a separate body confirmation `YES_UP_TO_12_WALKS`. No automatic retry or second scenario.
4. Deployed canary uses an atomic shared 2-journeys/hour limiter; the engine caps provider requests to 12 per journey, also behind a global limiter. Max up to **12 chargeable Stadia calls** for this one manual run; actual usage could be lower. Check the provider's credit balance before running.
5. Legacy anon JWT and the preview token are taken from **GitHub Secrets**, never hard-coded, echoed or passed to a frontend. The runner prints only aggregates and GTFS trip IDs (public transit data).
6. Required workflow inputs `service_date` (`YYYY-MM-DD`) and `depart_at` (`HH:MM`) use Europe/Dublin time. Invalid dates/times, dates outside today through +14 days, and already-passed departures today fail before any HTTP request. There is no automatic date replacement or retry. Date validation does not prove service availability; review the active GTFS calendar first.
7. The test fails if the response contains no bus + real-provider walking itinerary, has synthetic provider legs, or mismatched GTFS versions. Green Actions alone cannot establish safe sidewalk use, correct boarding bay, physical accessibility, or reliable live arrival times.

## Procedure

1. Review the correction on `fix/a11-explicit-service-date`, including the offline tests and workflow inputs.
2. Open a **Draft PR**, wait for the routing CI, and review code. Do not merge if CI fails.
3. Merge only after CI is green, then verify the `main` CI again.
4. Check Stadia plan/remaining credits. Open **Actions -> A11 first GTFS plus Stadia itinerary**; choose branch `main`, enter the reviewed `service_date` and `depart_at`, select `YES_ONE_ITINERARY_MAX_12_WALKS`, and run **ONCE** only with separate authorization for paid calls. The 2 GitHub Secrets from the successful read-only acceptance test are reused as-is.
5. Read the output to distinguish the bus ride, confirmed pedestrian geometry, street snap gaps, service times, coverage warnings, and any failure. If failed, **do not blindly rerun**: first inspect failure and credit/limiter state.

**No extra Supabase deployment, new tokens, or database migration is part of this patch.**
