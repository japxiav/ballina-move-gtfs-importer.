# Instructions to Codex / another deployment agent

Repository: `japxiav/ballina-move-gtfs-importer.` (literal trailing dot)
Branch: `main`. Compare with the current repo BEFORE writing; never overwrite newer work blindly.

User wants one carefully reviewed release, with each stage tested before advancing; do not publish an app on Vercel.

## Already in production, DO NOT repeat
- Supabase project `giwiqbnyozjbpmetrjhe`: migration `transport_quality_hardening_20261008` already applied and verified. Archived SQL is under `docs/applied_migrations` for **reference**, not reapplication.
- `transport-api` Edge Function v5 ACTIVE and locally simulated. Check live HTTP using publishable `apikey` header (not a secret) as a separate acceptance test.
- GTFS feed `768b4b82327a1b83eb7f9365e4dd4495417df14163e5980889f0df2b223088d3` is active and must not be changed just to check health.
- Realtime collector `collect-nta-v8` scheduled every minute and alternating channels. Preserve it.

## Pending git and deploy work
1. Audit repo state. Upload/commit this release as a branch/PR. Prior chat's GitHub integration refused writes with HTTP 403; do not assume it is fixed.
2. Run `bash scripts/run_tests.sh`, or at minimum `python -m unittest discover -s tests -v`. The result here: 41 Python pass, TS strict compilation pass, 10 simulated requests pass. Do not call this a live integration test.
3. Review GitHub workflow diff. The original activation succeeded, but the health gate failed due to querying `health.latest_runs` instead of `health.collector.latest_runs`. Upload `scripts/check_post_activation.py` and both workflows. The new dedicated hourly **read-only health check** does not rerun importer.
4. Independently hit live API `GET /functions/v1/transport-api?action=health`, `...action=departures`, `...action=vehicles` with publishable `apikey`. Confirm 200 and both realtime channels active; if not, repair before moving on.
5. `gtfs-import-api` v2 is only a prepared source; it was NOT deployed by the prior agent because deployment was blocked by tooling. Test throughput and Postgres token validation before enabling. The current v1 is functional but exposes raw errors and lacks throttling.
6. The `import_gtfs.py` v1.4 candidate adds safe conditional 304 and chronology checks. A real feed dry-run MUST pass before using activation again. **Never trigger `activate=true` to test the health workflow.**
7. `collect-nta-v8` remains unchanged: realtime-only local ADDED/REPLACEMENT may be filtered out before classification. Design correct local applicability check using monitored stop IDs / validated vehicle geofence and publish a separately tested collector update. Do not simply accept all national-route added trips.
8. `collect-nta-v7` remains a protected old implementation. Retire only after a validated rollback strategy.
9. Do not activate automatic GTFS import or deploy the webapp until acceptance checks pass.

## Non-goals / nonclaims
The archive captures evidence and GPS, not confirmed arrivals or a statistical no-show model. Future punctuality analysis needs observed stop passages, service-day reconciliation, denominator definitions, and confidence intervals. `unmapped_trips=0` applies only to the retained scope.
