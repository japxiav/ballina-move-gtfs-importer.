# Official scheduled journeys and live preview — 13 October 2026

The running English/mobile app is https://ballina-move-live.onrender.com/ ; the map is at `#/live`. The home page now searches official active GTFS schedules with dates/times, bus/rail filters, up to two same-stop connections, six result cards and itinerary details. Loading, empty, source-failure and retry states are explicit. Synthetic journeys remain at `#/demo`, never as a real-search fallback.

## Preserved source and authorized merges

- `feature/real-journey-search`: reviewed head `3892a197c2f5d8499648995dc58336051bf06871`; PR30 merged to main `a4acb4a52594ffb4cf7560e590d2849959efb8df`.
- `ops/live-gateway-hosting`: reviewed head `643bc525c1ab5f79c694259002258ed3af8468f6`; PR31 merged to main `3619cb090e719445bc2ec3618e0dcfd6edffd38c`.
- Main3619's tree exactly matches reviewed/deployed Ops643. All existing source/experimental branches remain preserved. This update changes documentation only.
- Draft PR26 (`fix/a12-indexed-frontier`, head7c55b82) remains isolated and unmerged. Older drafts inheriting failed A12 gates were not promoted.

## Actual publication and browser verification

The isolated Supabase `journey-api` is ACTIVE at version2. Only its two reviewed source files were published. The existing `transport-api` entrypoint, collectors, database contents, feed activation and private canary were unchanged. The publisher permits only this isolated function, with an explicit inspected-version guard for updates, no ambiguous retry or credential logging. HTTPS Management REST used the existing secure binding; the CLI's pre-HTTP proxy-placeholder rejection was a format limitation, not an invalid-token verdict. No secret was extracted or requested in chat/browser.

The existing free Render service `srv-db6nhvrbc2fs739pb7mg` was updated as deployment `dep-db6osr8m7kps73aothjg`, exact source643bc525. Workflow38333861699 succeeded after validation and immutable checkout. One Docker instance, auto-deploy disabled, no new service or paid upgrade. The browser receives no management credentials.

The active official feed is `768b4b82327a1b83eb7f9365e4dd4495417df14163e5980889f0df2b223088d3`, valid2026-10-07 through2027-10-07. Catalog HTTP200 returned227 stops. Actual public searches with zero/one/two permitted changes each returned HTTP200 and six options. Example on2026-10-13: bus420/trip5940_96270, Ballina Bus Station stop555051/id8490B5550501 08:00 to Mayo Hospital stop15109/id8490B151091 08:52. These are scheduled times, not predictions or a boarding promise.

Read-only official validation covered1518 trips/30115 stop times/9 routes/35 calendar rows/93 exceptions; malformed chronology and null-time counts were zero. A Foxford-to-Hospital connection joined at the exact Ballina stop ID with a long valid scheduled wait. It proves neither a physical bay nor optimality. Service dates/day offsets, pickup/dropoff, calendar exceptions, initial/transfer buffers and no repeated service-date/trip identity are checked.

Version1's one-change search initially failed with `search_capacity_reached`; the failure is retained. Exact destination indices and optimistic backwards same-stop topology pruning removed irrelevant expansion without raising caps or relaxing timed checks. A dense240-dead-trip regression and complete-query comparisons passed. Version2 passed the three actual public variants. No paid walking/provider queries.

Actual runner Chromium at01:51:39Z and direct public Chromium at02:07:44Z on2026-10-13 verified official results/details, six options, three ready live channels, three positions including two fresh bus GPS observations, attributed OSM tiles and widths320/360/390/601/801/1440. No browser credentials/private-host requests/page errors/horizontal overflow. Rail observation time/precision remain unknown. Normal proxy/TLS verification was retained.

## Validation and independent review

- Production/standalone builds, final96 desktop/mobile browser cases,55 offline gateway/deployment/publication contracts,50 importer tests, strict API/search checks and11 import-body tests passed. Synthetic navigation remains tested at `#/demo`.
- Main3619 web38335014676 and importer38335014695 CI succeeded. Feature389 PR38333213544/38333213540 and actual hosting workflow succeeded.
- Independent read-only reviews approved schedule contracts/topology, credential/publication boundaries, immutable Render updates and A12 rank invariants.
- Earlier failures are retained separately: CLI placeholder rejection, compiler PATH, outdated home assertions, version1 capacity failure and push web run38333208691. The last run's generic browser failure could not be independently classified because its log host was inaccessible. Subsequent exact-source CI, full local suites and actual host checks passed without relaxed assertions; not every historical run passed.

Evidence lives outside the checkout in `/workspace/.ballina-execution/real-search/`: public-browser proof, publication/deployment logs, actual query/snapshot validation, tests and exact merge records. Raw official validation rows are not served or published as fixtures.

## A12 local gate and remaining scope

The isolated candidate7c55b82 passed correctness/parity and nine serial rotated measurements of the original1518-trip/30360-stop-time workload, zero network calls. Median main CPU1864ms/peakRSS82.2MB; candidate CPU1636ms/peakRSS79.8MB: improvements12.2%/2.9%. All measured result sets matched. Earlier failures and the last candidate outlier remain retained. These local medians are not an SLA/confidence bound. See the A12 branch's `routing/README_A12_INDEXED_FRONTIER.md` and `/workspace/.ballina-execution/a12-virtual/byte-ranks/controlled-benchmark.json`.

The local A12 gates pass; Supabase/Deno real-host and pilot acceptance remain pending. The A12 engine/private canary is not merged/deployed. The public schedule solver does not silently activate it.

Passenger acceptance remains incomplete: walking, bays/platforms/accessibility, automatic delay/cancellation application to itineraries and real-host A12 validation. Searches around daylight-saving transitions fail closed. Free hosting can sleep; upstream failures remain explicit. Older Pages is a snapshot. No integrated forwarding button or production/pilot reliability is claimed.
