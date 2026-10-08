# Ballina Move GTFS Importer

Static GTFS importer for the National Transport Authority (Ireland) feed used by Ballina Move.

For rollout status and results of the staged hardening tests, see `docs/RELEASE_2026-10-08.md`. Some Supabase components are already deployed, while GitHub writes are awaiting upload. Do not assume all code is live.

Importer version: `1.4.0` (candidate branch/release).

## Current rollout state

The automatic **daily schedule is intentionally disabled**. The workflow is manual-only until both of these pass under supervision:

1. `activate=false`: full forced download → local validation → staging upload → database validation → staging cleanup.
2. `activate=true`: the same gates, followed by atomic activation and post-activation realtime/API checks.

Only after a future supervised acceptance sequence should the daily 04:17 UTC schedule be enabled. The 2026-10-08 activation succeeded but the old health gate had a JSON-path bug, fixed in this candidate release.

## Safety model

- A manual dry-run always downloads the full source ZIP; it cannot silently become a `304` no-op.
- Conditional HTTP (`ETag` / `If-Modified-Since`) is used only for non-forced real runs **and only when the previous accepted run used the same config hash**.
- `--force` bypasses upstream HTTP validators.
- Feed version identity includes source SHA-256, configuration SHA-256 and importer version.
- Downloads use bounded retry/backoff for transient HTTP/network failures.
- Supabase batch uploads retry transient failures; telemetry row creation is not blindly retried because a lost response is ambiguous.
- The worker uses a publishable Supabase key plus `GTFS_IMPORT_TOKEN`; it does not need a database-wide secret key in GitHub Actions.
- All importer RPCs exposed to the publishable role validate `GTFS_IMPORT_TOKEN` server-side.
- A database lease plus GitHub Actions concurrency prevents overlapping imports.
- The national ZIP is processed on disk and `stop_times.txt` is filtered through temporary SQLite rather than loaded wholesale into RAM.
- Duplicate GTFS IDs/stop-time keys and malformed selected rows fail closed rather than being silently replaced/skipped.
- Exact monitored stop IDs must remain inside their configured geographic radius.
- Coordinate fallback is radius-bounded, stricter name-aware and fails on close ambiguity.
- Every enabled regional route must still produce selected trips.
- Every enabled monitored target must have an actual time and at least one active service in the current day + next seven days.
- Local validation is repeated by a database-side staging validator before activation.
- The database validator checks references, service calendars, route/target counts, current feed window and catastrophic same-config regressions.
- Dry-run uses a unique inactive staging version, runs the database validator, then deletes staging. It is recorded as `validated`, not `unchanged`.
- `finalize_gtfs_import` activates atomically only after re-running the database validator.
- If the finalizer response is lost after commit, the worker re-reads the real feed state before deciding whether to abort or mark failure.
- `abort_gtfs_import` only deletes inactive versions.
- A future-dated feed is recorded as `deferred` rather than treated as a broken feed.
- GTFS service times use the specification's **"noon minus 12h"** service-day semantics so DST transition days and times beyond 24:00 are handled correctly by the departure board.

## Environment

Required:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `GTFS_IMPORT_TOKEN`

For local/backward compatibility, `SUPABASE_SECRET_KEY` is accepted only as a fallback when no publishable key is present. GitHub Actions does not use it.

Optional:

- `GTFS_URL`

## Commands

Full staging validation without activation:

```bash
python import_gtfs.py --dry-run --force
```

Supervised real activation:

```bash
python import_gtfs.py --force
```

Normal future scheduled mode, after acceptance:

```bash
python import_gtfs.py
```

## GitHub Actions

Workflow: `.github/workflows/gtfs-import.yml`

It currently supports manual dispatch only. `activate=false` is the safe default and performs a real staging/database dry-run. `activate=true` permits activation after all checks pass.

Required repository secrets:

- `SUPABASE_URL`
- `GTFS_IMPORT_TOKEN`

`SUPABASE_SECRET_KEY` is no longer needed by this workflow and can be removed from the repository after the v1.3.0 workflow is installed.

The project publishable key is intentionally present in the workflow because Supabase publishable keys are public client credentials; authorization for importer mutations comes from the separate token-gated RPC layer.

## Source

Default feed:
`https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip`
