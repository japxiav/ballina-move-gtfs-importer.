# Open risks / independently reviewed

| ID | Severity | Evidence | Owner / next verification |
|---|---|---|---|
| S1-identity | P1 | Repeated A→B visits collapsed by old trip/date/from/to key; BFF overwrote IDs | RESOLVED candidate PR33; unpublished: sequence/time and stable-ID regressions |
| S1-selection | P1 | Public15109 six-cap displaced later direct departures by dominated early transfers | RESOLVED candidate PR33; unpublished:1642 independent oracle comparisons |
| S1-cards | P1 | Equal-time15108 cards conceal distinct Castlebar/Hospital transfer | RESOLVED candidate PR33; unpublished: distinct transfer name/code/wait browser tests |
| S2-redirect | P1 before experimental activation | Private GTFS loader follows redirects with apikey | RESOLVED candidate PR34; not activated: redirect:error, bounded mocks and16parity |
| S2-json | P2 before experimental activation | Snapshot/walking response.json without byte limit | RESOLVED candidate PR34; not activated: byte/deadline/abort including hanging cancellation and lateEOF |
| S4-cancellation | P1 | Source cancellation observation discarded, cancellation never expires by own timestamp | RESOLVED candidate PR35; unpublished: own stamp/unconfirmed and fresh/old/missing/future tests |
| S6-quota | P1 | Shared anonymous global quotas; public key can consume Edge quota | Codex/owner: validate before accounting; private consumer policy requires binding approval; keep emergency caps |
| S6-errors | P2 | BFF masks upstream429/known search errors as503 | RESOLVED candidate PR35; unpublished: whitelisted bounded400/429/503/RetryAfter |
| S6-privacy | P2 | Default server exception handler may log address/trace; third-party processor/license gaps | Codex/owner: sanitized handling; source terms/processors/contact review |
| S3-resources | P1 release gate | A12 only localNode workload proof, not deployedDeno | Codex/owner: approved isolated host comparison and rollout/rollback |
| S7-availability | P1 release gate | Free host idle, no SLO window or controlled restore proof | Owner/Codex: approved budget/observability and rehearsal |
| S8-field | P1 release gate | No physical hospital access, platforms, accessibility or pilot evidence | Regional testers/owner: field matrix and actual7day observation |

No demonstrated P0 found in these read-only reviews; that is not a pentest certification or proof of zero passenger defects. Status changes need linked RED/GREEN/actual-source evidence.
