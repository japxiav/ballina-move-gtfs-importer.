# Audit fixes applied on 2026-10-06

This document records the fixes made after an independent AI audit of the GTFS importer and live Supabase backend.

## Importer v1.3.0

- Dry-run now performs a full forced source download, stages rows in Supabase, runs database validation and deletes staging without activation.
- Added `--force` to bypass ETag/Last-Modified validators.
- Conditional HTTP state is reused only when the configuration SHA matches the current config.
- Finalize failures are reconciled against the actual active feed before abort/failure telemetry.
- Added bounded retry/backoff for transient source downloads and idempotent batch uploads.
- Future-dated feeds return `deferred` rather than generic failure.
- Exact canonical-stop coordinate guard was tightened to the configured target radius.
- Coordinate fallback name matching is stricter.
- Duplicate route/stop/trip IDs and duplicate `(trip_id, stop_sequence)` rows fail closed.
- Invalid selected stop-time rows no longer disappear silently.
- Monitored stop times require an actual arrival/departure value.
- Every monitored target must have service during today + the next seven service days.
- Every enabled route must still produce selected trips.
- Dry-run telemetry remains `validated`, not `unchanged`.
- Tests expanded from 14 to 24 and include finalize-response ambiguity, dry-run staging cleanup and config-scoped conditional requests.

## Database validation

Live migration `20261006152650 harden_gtfs_import_validation_gate` added a non-activating staging validator and made finalization reuse it.

The validator now checks, among other things:

- core row counts and references
- enabled target count directly from `gtfs_import_targets`
- enabled route count directly from `regional_routes`
- agency/service/shape references
- trips with fewer than two stops
- current feed date window
- service availability at all monitored stops over the next seven days
- catastrophic >50% stop/trip/stop-time regression versus the previous complete feed when the configuration SHA is unchanged

## DST / service-day semantics

Live migration `20261006153147 fix_gtfs_service_day_dst_semantics` changed scheduled-time construction to the GTFS-defined "noon minus 12h" service-day origin rather than naïve local midnight.

Verified against the Europe/Dublin 2026 DST fall-back boundary:

- service day 2026-10-24 at `24:30` resolves to 2026-10-25 00:30 local
- service day 2026-10-25 at `00:30` resolves using the GTFS DST-safe origin

## Stale realtime

Live migration `20261006154216 mark_stale_departure_realtime_as_scheduled_no_realtime` preserves the distinction between never-observed scheduled departures and departures whose realtime became stale.

A live check at `now + 30 minutes` returned both `scheduled` and `scheduled_no_realtime`, proving stale data is not applied as live delay.

## Import credential isolation

The GitHub worker no longer needs `SUPABASE_SECRET_KEY`.

A dedicated Edge Function `gtfs-import-api` is the only public gateway for the worker. It requires:

1. the project's publishable key, and
2. the separate `GTFS_IMPORT_TOKEN`.

The Edge Function then calls a fixed whitelist of service-role-only RPCs. The SECURITY DEFINER import RPCs were re-closed to `anon` after the gateway was deployed.

Security advisor after this change returned only the intentional `RLS enabled / no client policy` INFO notices. The temporary SECURITY DEFINER/anon warnings disappeared.

A live gateway test returned HTTP 200 with the correct importer config. A deliberately wrong import token returned an authorization failure.

## Health heartbeat

`transport-api` v4 now reports:

- collector health
- collector run age and heartbeat threshold
- collector version
- latest realtime runs
- latest importer state
- active-feed schema completeness

It returns HTTP 503 when the collector heartbeat is stale or the latest collection run is unhealthy.

A live health request after deployment returned HTTP 200, `collector.healthy=true`, collector `v8`, and the current `legacy_partial` active feed.

## Rollout gate

The GitHub Actions schedule remains intentionally disabled.

Required acceptance order:

1. Push this package to the repository root.
2. Manual workflow with `activate=false`.
3. Review row counts, target matches and DB validation output.
4. Manual workflow with `activate=true`.
5. Verify active feed becomes `complete_nta_feed`.
6. Verify realtime v8 remains `unmapped_trips=0` for several cycles.
7. Verify departures/vehicles/health.
8. Only then enable the daily scheduled import.
