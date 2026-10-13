# Test matrix

Baseline SHA22bf89c: forced local routing404,staging11,web96,gateway55,importer50,scheduled9/topology1/isolatedAPI2/importbody11; no skips.16-module parity and production/standalone build pass. Logs live outside checkout, with exact runtime/service metadata in BASELINE.md.

S1 regression matrix: official historical six-trip fixture15108/15109 (not live data), same-name different stop IDs/transfer waits, operational loop A→B→A→B with sequences1/2 and3/4, completed dominance before cap, nativeSHA256 stable IDs across row/text/query-order changes, changed-feed IDs, gatewaypreservation/duplicate/malformedIDs/sequence checks, browser equal-time disambiguation/deep-link reorder and missing itinerary. Initial RED: solver1pass/3fail, gateway7pass/2fail, browser4fail. GREEN source build: solver5pass, independent1642 exhaustive-oracle comparisons, full browser100pass, gateway57pass. Further independent oracle/reviews and final exact-SHA CI are recorded before readiness.

Preexisting coverage retained: calendar/DST rejection, midnight service dates, pickup/dropoff, invalid queries, stale GPS/predictions, unknown rail observation time, failures, two bounded schedule workers, SSRF/redirect/static file boundaries and credential-free requests. DST support itself is still absent; a fail-closed test is not a supported clock-change journey.

External tests UNVERIFIED: physical pedestrian paths/entrances/boarding, iOS Safari/VoiceOver real device, target Supabase CPU/RSS/cold start, real matching of RT identity, rehearsal of production restore, pilot observations. Do not fill these with synthetic results.

Independent review approved skyline/opaque-ID/UI paths; adversarial review discovered overlong source IDs could alias under truncation. They now fail closed before search; supported IDs are exact public references, not a global GTFS constraint.
