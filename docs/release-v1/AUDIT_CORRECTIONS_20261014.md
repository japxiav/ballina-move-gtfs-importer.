Audit target: published `06b72b428fa623e7daf4d244b4851683506b78d0`.
Reviewed application source: `b8c01ec2c21297e8a5029598475f309b7c6769ca`.
Final benchmark reproducer correction: `b860f606696b89276464224c179916095e636cda` (application/Edge/gateway source identical).
Main remains `f38826625e08fe6bcd92073df45685fa36bbf7cf`.
No public deployment, main merge, production migration, secret change or paid
provider request was made during these corrections. Regional release is NO-GO.

| Finding | Implemented correction / remaining evidence | Draft PR |
|---|---|---|
| BM-AUD-01/02 | Canonical canceled/cancelled/skipped/no_data; source timestamps, stale/unconfirmed states, exact hashed identities. Active SQL executes ten synthetic cases through gateway and browser. | #50 |
| BM-AUD-07 | Cache suffix never selects a feed before the current catalog; cold reads stay parallel; exact feed lookup and original TTL retained. | #51 |
| BM-AUD-05 | Validated v2 reported operator/route/trip/direction/mapping references. Feed/service-date linkage, stops, shapes and ETA remain explicitly unverified. Actual database mapping variants added in #55. | #52, #55 |
| BM-AUD-06 | Distinct empty/unavailable/expired/future states, viewport versus Ireland counts, Show Ireland, retrieval/next actual poll, tile independence. Rail retention expiry does not claim known observation age. | #53 |
| BM-AUD-04 | Europe/Dublin unique instants; GTFS noon-minus-12-elapsed-hour origin; schedule v2 reference; correct clocks/day suffix and fold offset. Only nonexistent/ambiguous query times fail. Twenty independent ZoneInfo cases cover adjacent dates, overnight, cross-service-day connections and72h boundary. | #54, #55 |
| BM-AUD-09 | Public DDL baseline restores23tables/23RPCs/3sequences; full structural catalog/owners/ACL/identity parameters match; RPC replay passes.36 current migration hashes retained; audit's39 count unresolved. Complete hosted Supabase/collector recovery remains unproved. | #55 |
| BM-AUD-03 | TCP peer shaping remains in force. Actual Render trusted consumer identity is NOT proved. No trust was added to client-supplied X-Forwarded-For/headers/cookies, and no budgets were disabled. Needs authenticated host-boundary evidence and a separately authorized bounded hosted test. | Open P1 |
| BM-AUD-08 | Independent Codex reviews completed for implemented scopes. CodeRabbit's draft notices are NOT an approval. User authorized trigger comments on PRs45–56; all twelve original-head reviews completed (five without actionable comments). Reported findings were validated: current-code fixes, two documented conditional/already-protected cases, and the existing CI correction are tracked separately. Revised3619cc4 reviewed again: matching head/range, success status and completed summary without new actionable comments; this is not approval or regional readiness. | Open process gate |

New inherited P2: anonymous/authenticated SELECT/USAGE/UPDATE grants on three
sequences. A **proposed** revocation is tested after the faithful restore; denial
and unchanged service_role privileges pass. It is not applied to production.
The public HTTP surface has not been shown to expose sequence mutation directly.

Validation: build/standalone passed;200 desktop/mobile browser tests,100 gateway
tests,72 root Python tests,20 independent DST cases and1642 schedule oracle
comparisons passed. Mock publisher unit-test notices using `aaaaaaaa...` and
`dep-offline` are synthetic tests, not deployments. Offline SQL replay runs in a
pinned RAM-only PostgreSQL container, without network, exposed ports or real
passenger/transport rows.

Performance evidence keeps **all** results, without relaxing any gate:

- Original solve-only nine-process comparison: equivalent itineraries, CPU and
  wall passed; RSS failed (81.695 versus78.148MiB corrected PR36).
- New explicit cold-module/query-validation/solve mode measures the real
  Europe/Dublin input-validation path on every version. First run overlapped
  browser/root work and failed wall time; retained as a failure.
- Nine isolated serial rotated request-path samples passed against corrected
  PR36: CPU75.826≤96.186ms, wall46.805≤62.140ms, RSS81.910≤82.141MiB. RSS remains
  higher than main; this does not certify hosted p95/p99, capacity or A12.

Evidence and hashes: `evidence/audit-20261014/`. Remote web validation passed for all seven branches; importer validation passed where triggered, including the final b860 source. Final web CI run38498811418 and importer run38498811906 passed. Existing live06 and main f388 refs remain unchanged. The three-read management inventory confirms existing free plan, autoDeployOFF and journey-api v4; no publication or secret values were queried.

Mobile screenshots show actual local Chromium rendering with retained official hospital data replayed offline (two journey reads, zero external browser requests/errors). They do not prove current service availability or a public update.

The isolated request-path pass uses the same solver hash as the failed runs; it is a different measurement condition, not another optimization. The RSS margin over corrected PR36 is only0.230MiB. Module initialization, validation and solve are included; snapshot parsing, HTTP/gateway and response serialization are excluded. The legacy solve mode initialization order is preserved by b860.
No seven-day pilot, real pedestrian/hospital entrance verification, physical
device/manual accessibility audit or hosted disaster-recovery exercise occurred.
Those gates remain unverified rather than being fabricated as software fixes.

CodeRabbit follow-up: owner explicitly authorized trigger comments on PR45–56.
Twelve exact original heads reached CodeRabbit success with completed summaries;
five had no actionable comments. Eleven reported comments were checked against
the integrated source: eight confirmed items were fixed/strengthened, one
conditional tile-redraw guard was added, one CI item was already fixed, and one
early-place-results claim was not reproduced (original and current UI both
require !loading). No CodeRabbit CLI, new subscription or provider setup was used.

The follow-up3619cc4 is preserved in PR56 and the separate fix branch. Build,
208 browser tests,101 gateway tests,72 root Python tests,20 DST/1642oracle and
ten full-schema SQL cases pass. Fresh external review and CI completed on the updated head: CodeRabbit
summary covers cc2087f→3619cc4, reports no new actionable comments, and the
3619 commit status is success. Web CI38525698624 and importer CI38525698662
passed. This is separate from the original-head review evidence and does not
certify hosted resources or regional readiness. Regional host identity remains unproved. Current public06 and main
f388 are untouched. The prior publication question names b860; no new source
has been published under an assumed authorization.

## Authorized publication — 14 October 2026

The owner subsequently authorized audit, correction and publication without another confirmation. Source `3619cc4` is now live on the existing Render preview; journey-api is ACTIVE at version 5. Actual HTTPS Chromium verified real hospital journeys, itinerary navigation, train positions, map tiles and six responsive widths. Public assets and fetched Edge sources match the reviewed build. Main, database migrations, plans and credentials were unchanged. No rollback was needed. Bus source returned empty; departure source unavailable, both disclosed by the UI. Regional launch gates remain open. Evidence: [publication receipt and browser proof](evidence/published-audit-20261014/README.md).
