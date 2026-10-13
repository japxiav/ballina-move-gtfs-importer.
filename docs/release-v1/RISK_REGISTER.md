# Open risks / independently reviewed

| ID | Severity | Evidence | Owner / next verification |
|---|---|---|---|
| S1-identity | P1 | Repeated A→B visits collapsed by old trip/date/from/to key; BFF overwrote IDs | Codex: sequence/time identity and stable-ID regressions |
| S1-selection | P1 | Public15109 six-cap displaced later direct departures by dominated early transfers | Codex: completed skyline against independent exhaustive oracle |
| S1-cards | P1 | Equal-time15108 cards conceal distinct Castlebar/Hospital transfer | Codex: code/name/wait + browser tests |
| S2-redirect | P1 before experimental activation | Private GTFS loader follows redirects with apikey | Codex: refuse redirects, bounded mocks/parity |
| S2-json | P2 before experimental activation | Snapshot/walking response.json without byte limit | Codex: byte/deadline/abort checks and retained geometry validation |
| S4-cancellation | P1 | Source cancellation observation discarded, cancellation never expires by own timestamp | Codex: fresh/old/missing/future contract regressions |
| S6-quota | P1 | Shared anonymous global quotas; public key can consume Edge quota | Codex/owner: validate before accounting; private consumer policy requires binding approval; keep emergency caps |
| S6-errors | P2 | BFF masks upstream429/known search errors as503 | Codex: explicit bounded safe error DTO/RetryAfter |
| S6-privacy | P2 | Default server exception handler may log address/trace; third-party processor/license gaps | Codex/owner: sanitized handling; source terms/processors/contact review |
| S3-resources | P1 release gate | A12 only localNode workload proof, not deployedDeno | Codex/owner: approved isolated host comparison and rollout/rollback |
| S7-availability | P1 release gate | Free host idle, no SLO window or controlled restore proof | Owner/Codex: approved budget/observability and rehearsal |
| S8-field | P1 release gate | No physical hospital access, platforms, accessibility or pilot evidence | Regional testers/owner: field matrix and actual7day observation |

No demonstrated P0 found in these read-only reviews; that is not a pentest certification or proof of zero passenger defects. Status changes need linked RED/GREEN/actual-source evidence.
