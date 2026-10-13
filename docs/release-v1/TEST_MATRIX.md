> Authoritative13October2026 product-mission checkpoint: unpublished code `06b72b428fa623e7daf4d244b4851683506b78d0`; published preview `3a96758b87d33908635f03d2e833cd5742609997`, journey-api version4, main `f38826625e08fe6bcd92073df45685fa36bbf7cf`. See [PROGRESS](PROGRESS.md) and [current evidence](evidence/product-mission-20261013/validation.json). Existing sections below are historical phase evidence, not current production/source pointers. Regional NO-GO remains. Do not execute historical publication/rollback instructions without checking current source, available provider rollback and specific authorization.

# Test matrix

Baseline SHA22bf89c: forced local routing404,staging11,web96,gateway55,importer50,scheduled9/topology1/isolatedAPI2/importbody11; no skips.16-module parity and production/standalone build pass. Logs live outside checkout, with exact runtime/service metadata in BASELINE.md.

S1 regression matrix: official historical six-trip fixture15108/15109 (not live data), same-name different stop IDs/transfer waits, operational loop A→B→A→B with sequences1/2 and3/4, completed dominance before cap, nativeSHA256 stable IDs across row/text/query-order changes, changed-feed IDs, gatewaypreservation/duplicate/malformedIDs/sequence checks, browser equal-time disambiguation/deep-link reorder and missing itinerary. Initial RED: solver1pass/3fail, gateway7pass/2fail, browser4fail. GREEN source build: solver5pass, independent1642 exhaustive-oracle comparisons, full browser100pass, gateway57pass. Further independent oracle/reviews and final exact-SHA CI are recorded before readiness.

Preexisting coverage retained: calendar/DST rejection, midnight service dates, pickup/dropoff, invalid queries, stale GPS/predictions, unknown rail observation time, failures, two bounded schedule workers, SSRF/redirect/static file boundaries and credential-free requests. DST support itself is still absent; a fail-closed test is not a supported clock-change journey.

External tests UNVERIFIED: physical pedestrian paths/entrances/boarding, iOS Safari/VoiceOver real device, target Supabase CPU/RSS/cold start, real matching of RT identity, rehearsal of production restore, pilot observations. Do not fill these with synthetic results.

Independent review approved skyline/opaque-ID/UI paths; adversarial review discovered overlong source IDs could alias under truncation. They now fail closed before search; supported IDs are exact public references, not a global GTFS constraint.

Integrated compositioncbd1152:414routing,116desktop/mobile browser,63gateway/operations,11staging,50rootPython plus existing strict/runtime/API suites and1642oracle comparisons; zero suite skips. Observer adds10meaningful offline regressions, making root60. Final frozen-SHA logs/CI are collected separately before a quality claim. Regional matrix32local queries:28options/4empty; no field/network proof.
