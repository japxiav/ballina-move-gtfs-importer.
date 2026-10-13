# Regional release candidate — not published

Decision: **NO-GO for reliable public v1**. These changes are implemented, locally integrated and independently reviewed; they are a technical candidate, not a passenger acceptance certificate.

Base/main: `22bf89cbbe5eb81ca40dee52410a4d11c99382d5`. Published Render source remains `643bc525c1ab5f79c694259002258ed3af8468f6`; published journey-api remains ACTIVE v2. Its two downloaded source hashes match base exactly (BASELINE.md). No main merge/deployment/database/collector mutation in this phase.

Separate Drafts: [PR33](https://github.com/japxiav/ballina-move-gtfs-importer./pull/33) S1 `9b5e7ef`, [PR34](https://github.com/japxiav/ballina-move-gtfs-importer./pull/34) S2 `bb29573`, [PR35](https://github.com/japxiav/ballina-move-gtfs-importer./pull/35) S4/S5/S6 `13c1705`. Integration branch `integration/release-v1-reviewed` preserves all three and their regressions. Its immutable final SHA is the PR head / CI checkout, not an embedded self-referential hash. A12 PR26 stays separate and unpublished.

Implemented: exact operational leg identity and sequence references; completed Pareto selection before six-result cap; stable native SHA256 public IDs; different transfer stops/waits on cards; selected hospital destination warning; bounded experimental GTFS/walking reads and refused redirects; cancellation's own observation timestamp and unconfirmed state; safe 400/429/503 errors; bounded privacy-preserving logs; compact English results with expandable search; aborted sibling catalog requests after failure; manual fixed-destination observer with DNS-process watchdog. Public walking stays disabled and realTimeApplied stays false.

Validation: 414 routing, 116 browser desktop/mobile, 63 gateway/operations contracts, 11 staging, root API suites plus importer tests; independent exhaustive oracle 1642 comparisons. Ten additional observer tests cover slow-read freshness, deadline/oversize/stalled bodies and watchdog. See TEST_MATRIX.md and EVIDENCE_INDEX.md for exact run provenance, failures and external limits.

32 official-capture regional offline queries: 28 with results / 4 empty, zero provider calls. Both are valid outcomes subject to the supported stop-to-stop contract; this is not a completeness oracle or field test. No pedestrian paths, boarding access, accessibility, RT itinerary matching, real-host CPU/RSS margins, 7-day pilot or controlled restore is certified. See GO_NO_GO.md.
