# Ballina Move Routing v0.10.0 | rail candidate

**CANDIDATE ONLY: not deployed, not merged or verified by remote GitHub CI.**

This package builds on the verified v0.9.9 routing code. Changes are opt-in and retain the default bus-only search.

## What changed

- Trip planning accepts `modes: ["bus"]` (default), `modes: ["rail"]`, or `modes: ["bus", "rail"]` via POST `/v1/journeys`. Unknown, duplicate or empty mode lists fail with HTTP 400. This is an explicit mode selection, not automatic enablement of rail.
- Existing rail GTFS `route_type=2` is now used in journey planning when requested. The response contains scheduled ride legs with `mode: "rail"`; **not verified realtime**.
- Tight rail interchange warning for connections up to five minutes. Three-minute scheduled rail-to-rail interchange at Manulla Junction is preserved when it satisfies the existing 180-second transfer minimum. Timetabled does NOT mean guaranteed or platform-verified.
- GET `/v1/rail/stations` discovers stations from active GTFS train services, with names and official approximate coordinates; returns `realtime:false` and `platformVerified:false`. No walking calls.
- Optional GET `/v1/rail/station-board?station=Ballina` from the official Irish Rail API. Disabled unless a trusted server injects `getRailStationBoard` and the private preview sets `BALLINA_RAIL_REALTIME_ENABLED=true`. Station names must match GTFS rail-served stations; 30 shared requests/minute ceiling; client cache 45 sec; max response size 256 KB; 5 sec timeout; no arbitrary host URLs.
- The Irish Rail API service code is NOT automatically matched to NTA GTFS trip IDs. Provider values may be **scheduled only** for Athlone-Westport/Ballina, so `realtimeVerified:false` always until separately corroborated.
- Source and Deno .ts mirror synced; new single-file `artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts` generated from sixteen modules. Historic v0.9.9 artifact is not overwritten.

## Local tests

```
cd routing
npm ci --ignore-scripts
npm test
node scripts/build_singlefile_candidate_010.cjs
npm run verify:artifact
node --test ../staging/tests/sealed_gate.test.cjs
```

No Stadia calls or Irish Rail network calls in these tests. Fixtures deliberately distinguish **published GTFS-derived times** and synthetic boarding geometry. CI remains required on GitHub with the exact TypeScript 5.9.3 dependency.

## Example route request

```json
{
  "serviceDate":"2026-10-09",
  "departAt":"09:00",
  "origin":{"lat":54.108,"lon":-9.156},
  "destination":{"lat":53.346,"lon":-6.293},
  "modes":["bus","rail"],
  "maxTransfers":2,
  "maxWalkingMeters":2000,
  "limit":3
}
```

**Illustrative input only.** Any actual itinerary must use that day's active GTFS, verified pedestrian routes, and applicable calendar service. No real timetable is asserted by this example.

## Release gates still pending

1. GitHub feature branch CI after upload. Do not upload to `main` or merge automatically.
2. Audit actual GTFS rail itineraries in private staging; benchmark CPU, RAM and cold starts.
3. Confirm provider behavior, station mapping and data freshness on Mayo's limited-real-time railway before enabling `BALLINA_RAIL_REALTIME_ENABLED`.
4. Walking provider remains metered and disconnected in existing sealed staging; switch to Ballina Walking Engine after separate verification.
5. Prod collector v8, `transport-api` and old preview must not be modified as part of this candidate.

Primary upstream API documentation: https://api.irishrail.ie/realtime/ ; https://api.irishrail.ie/realtime/realtime.asmx?op=getStationDataByNameXML
