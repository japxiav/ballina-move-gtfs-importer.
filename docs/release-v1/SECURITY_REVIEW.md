# Security review — bounded scope

Independent read-only reviews approved S1 operational identities, S2 response hardening and S4/S6 sanitized DTO/error paths, with no demonstrated new P0/P1 blocker. This is source/contract review, not a penetration-test certification.

Resolved in candidate: strict operational IDs instead of truncating aliases; credential-bearing GTFS redirects refused; streamed GTFS/pedestrian 1MiB bounds and deadlines with interruptible cancellation; malformed/error payloads fail closed; cancelled/old/missing/future observations never become confirmed cancellation or scheduled service; safe whitelisted errors and Retry-After clamp; invalid queries checked before shared quota; gateway exception messages exclude addresses/tracebacks; browser has no management keys; local observer fixed to three public paths, no retries/cron/credentials, sanitized metadata, per-response freshness and 47s process watchdog including DNS.

Independent review identified parallel catalog siblings retained after an early failure; controller.abort now runs in finally, regression tests preserve the visible failure. Observer review found stale sample clocks and unbounded resolver waits; fixes and ten offline tests added. Production retains old source until reviewed publication.

Open P1: shared anonymous Edge/BFF quota can be consumed by other clients. Keep existing emergency caps; do not trust client headers/cookies/publishable keys as private identity. A private consumer policy needs a server-only binding and an approved coordinated Edge/BFF rollout. No credential was requested or exposed. Terms, processors, retention, operator notices and contact policy need owner acceptance. No paid provider calls, feed activation or private service exposure occurred.
