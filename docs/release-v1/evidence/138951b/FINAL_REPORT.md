# Final audit checkpoint — 13 October 2026

1. **State: PARTIAL / NO-GO for reliable public regional v1.** The hospital correction and technical candidate are implemented. Current preview remains usable for supported official stop-to-stop schedules and a separate map. Source/field/availability limits stay explicit.

2. **Before → after.** Repeated stop visits no longer alias; operational sequences and native SHA256 itinerary IDs remain stable. Completed dominated detours are removed before the six-card cap; different hospital transfer stops/waits remain visible. Own cancellation timestamps expire into unconfirmed, errors stay safe, parallel reads abort, and mobile results precede the expandable form. Experimental credential-bearing reads refuse redirects and bound streamed responses. No walking or realtime itinerary claim was added. Clock-test failures were independently reproduced and fixed without weakening expiry assertions; RED traces remain preserved.

3. **Code and preservation.** Base/main22bf89c; exact candidate138951b5156b0174cdd61d7491eec7f0c77d9c2f on integration/release-v1-reviewed, [DraftPR36](https://github.com/japxiav/ballina-move-gtfs-importer./pull/36). Original DraftPR33/34/35 and fix/release-v1-browser-clock retained separately. A12PR26 remains isolated. No main merge/force push/deployment. Evidence-only branch docs/release-v1-final-evidence records this completed run without changing the tested candidate.

4. **Checks.** Exact candidate:414routing,116desktop/mobile browser,63gateway/operations,11staging,60rootPython,2static-boundary plus strict/mock API checks and1642independent oracle comparisons; all completed successfully with zero suite skips.80targeted expiry repetitions (60+20) passed. Final routing/offline/web CI checks passed on the exact head; deploy/probe jobs were skipped by design. Committed artifact parity16/16 and standalone build passed. Independent code/document reviews found no new scoped P0/P1 blocker; not a penetration/field certificate. Earlier failures including one unavailable PR35 assertion are preserved, not described as passed.

5. **Performance/cost.** Nine alternating serial samples/version on official captured1518trips/30115times: medianCPU76.77→85.12ms(+10.9%), whole-process peakRSS77.37→77.52MB(+0.2%); correctness cost, not optimization. All samples/ranges/hash association retained. No targetEdge margin/p95/cold-state claim. Existing free Render plan verified; actual Supabase billing unknown. Paid walking calls0; no upgrade/new service/recurring monitoring.

6. **Actual production.** [Open app](https://ballina-move-live.onrender.com/) / [map](https://ballina-move-live.onrender.com/#/live). Published source remains643bc52, journey-apiv2; downloaded function source matches main22bf89c exactly. Actual Chromium04:18:13Z verified scheduled6options/details, maptiles, widths320/360/390/601/801/1440 and no browser credentials. Bus channel empty/0freshGPS;10train positions are reported locations with unknown observation time, not verified GPS. Candidate screenshots are explicitly unpublished/offline GTFS replay. No platform integrated forwarding is provisioned.

7. **Gates and risks.**

| Gate | Status at final checkpoint | Owner / remaining evidence |
|---|---|---|
| G0 provenance | PASS | Codex: exact current/main/published function/feed identities |
| G1 journeys | PARTIAL | Codex/testers: hospital/oracle and32offline regional queries (28options/4empty), field/completeness pending |
| G2 walking | UNVERIFIED | Regional testers: entrances/paths/crossings/boarding/accessibility; disabled publicly |
| G3 technical quality | PASS scoped candidate | Codex: exact-head complete suites/CI/source reviews; external acceptance remains separate |
| G4 realtime | PARTIAL | Codex/operators: cancellation freshness fixed locally; published old source/full itinerary identity matching incomplete |
| G5 security | PARTIAL | Codex/owner: bounds/privacy/errors fixed; anonymous consumer quota/fairness P1 remains |
| G6 resources | UNVERIFIED | Codex/owner: reviewed target-Deno/host comparison and margins |
| G7 operations | PARTIAL | Owner/Codex: manual observer/runbook; no recurring SLO window or restore rehearsal |
| G8 UX/legal | PARTIAL | Owner/reviewers: compactEnglish/mobile tests; real-device accessibility, terms/processors/retention acceptance |
| G9 external proof | UNVERIFIED | Regional testers: actual field evidence and7elapsed pilot days |
| G10 release | BLOCKED | Owner: preceding evidence and final humanGO absent |

No demonstrated new P0 in scoped reviews. Open P1: anonymous quota, host resources/availability/restore and physical/pilot evidence. P2: legal/retention/manual-device review. These prevent reliable-v1 publication.

8. **Next necessary work.** Prepare and review a server-only consumer-policy/target-host/restore experiment before any production mutation, define an approved monitoring budget/window, and obtain genuine regional field/accessibility/pilot observations. No paid calls/private credentials needed for reviewing current code. Reusable environment draft saves exact candidate and restart instructions; the platform requires Review/Save/Publish of the environment to activate it for future tasks. This does not deploy the app or block the existing HTTPS preview.
