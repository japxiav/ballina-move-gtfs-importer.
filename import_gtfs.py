#!/usr/bin/env python3
"""Ballina Move / Mayo GTFS static importer.

Stdlib-only worker for the NTA static GTFS ZIP. It stages a validated subset in
Supabase and activates it atomically only after database-side validation passes.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator
from zoneinfo import ZoneInfo

IMPORTER_VERSION = "ballina-move-gtfs-importer/1.3.0"
DEFAULT_GTFS_URL = "https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip"
FEED_LABEL = "nta-realtime"
BATCH_SIZE = 500
MAX_ARCHIVE_BYTES = 2_500_000_000
MAX_UNCOMPRESSED_BYTES = 6_000_000_000
REQUIRED_FILES = {
    "agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt",
    "feed_info.txt", "shapes.txt",
}
OPTIONAL_FILES = {"calendar.txt", "calendar_dates.txt", "translations.txt"}

REQUIRED_COLUMNS: dict[str, set[str]] = {
    "agency.txt": {"agency_id", "agency_name", "agency_url", "agency_timezone"},
    "feed_info.txt": {"feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date"},
    "routes.txt": {"route_id", "agency_id", "route_type"},
    "stops.txt": {"stop_id", "stop_name", "stop_lat", "stop_lon"},
    "trips.txt": {"route_id", "service_id", "trip_id"},
    "stop_times.txt": {"trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"},
    "calendar.txt": {"service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"},
    "calendar_dates.txt": {"service_id", "date", "exception_type"},
    "shapes.txt": {"shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"},
    "translations.txt": {"table_name", "field_name", "language", "translation", "record_id", "field_value"},
}

DUBLIN_TZ = ZoneInfo("Europe/Dublin")


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing_environment:{name}")
    return value


def parse_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def parse_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_bool01(value: str | None) -> bool:
    return str(value or "0").strip() == "1"


def parse_gtfs_date(value: str | None) -> str | None:
    if not value:
        return None
    s = value.strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return s or None


def gtfs_seconds(value: str | None) -> int | None:
    if not value:
        return None
    m = re.fullmatch(r"(\d{1,3}):(\d{2}):(\d{2})", value.strip())
    if not m:
        raise ValueError(f"invalid_gtfs_time:{value}")
    h, mi, sec = map(int, m.groups())
    if mi > 59 or sec > 59:
        raise ValueError(f"invalid_gtfs_time:{value}")
    return h * 3600 + mi * 60 + sec


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


class Supabase:
    def __init__(self, url: str, api_key: str, import_token: str):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.import_token = import_token

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        prefer: str | None = None,
        *,
        timeout: int = 60,
        retries: int = 0,
    ) -> Any:
        headers = {
            "apikey": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": IMPORTER_VERSION,
        }
        # New sb_secret keys are not JWTs. Legacy service_role JWTs still need Authorization.
        if self.api_key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {self.api_key}"
        if prefer:
            headers["Prefer"] = prefer
        data = None if body is None else canonical_json(body)
        retryable_statuses = {408, 425, 429, 500, 502, 503, 504}
        last_error: BaseException | None = None
        for attempt in range(retries + 1):
            req = urllib.request.Request(
                f"{self.url}{path}", data=data, headers=headers, method=method
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    raw = response.read()
                    if not raw:
                        return None
                    return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:2000]
                last_error = RuntimeError(f"supabase_http_{exc.code}:{path}:{detail}")
                if exc.code not in retryable_statuses or attempt >= retries:
                    raise last_error from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                last_error = RuntimeError(f"supabase_transport_error:{path}:{exc}")
                if attempt >= retries:
                    raise last_error from exc
            time.sleep(2 ** attempt)
        assert last_error is not None
        raise last_error

    def get(self, table: str, query: str) -> Any:
        return self._request("GET", f"/rest/v1/{table}?{query}", retries=2)

    def insert(self, table: str, row: dict[str, Any], returning: bool = False) -> Any:
        # Do not automatically retry inserts: a lost response can make an otherwise
        # successful insert ambiguous and create duplicate telemetry rows.
        return self._request(
            "POST", f"/rest/v1/{table}", row,
            "return=representation" if returning else "return=minimal",
        )

    def patch(self, table: str, filter_query: str, row: dict[str, Any]) -> Any:
        return self._request(
            "PATCH", f"/rest/v1/{table}?{filter_query}", row, "return=minimal", retries=2
        )

    def rpc(self, name: str, body: dict[str, Any], *, retries: int = 0, timeout: int = 60) -> Any:
        action_by_rpc = {
            "get_gtfs_import_config": "config",
            "start_gtfs_import_run": "start_run",
            "update_gtfs_import_run": "update_run",
            "get_gtfs_import_http_state": "previous_http_state",
            "get_gtfs_feed_state": "feed_state",
            "claim_gtfs_import_worker": "claim_lock",
            "release_gtfs_import_worker": "release_lock",
            "begin_gtfs_import": "begin",
            "import_gtfs_batch": "batch",
            "validate_gtfs_import": "validate",
            "finalize_gtfs_import": "finalize",
            "abort_gtfs_import": "abort",
        }
        action = action_by_rpc.get(name)
        if not action:
            raise RuntimeError(f"unsupported_import_rpc:{name}")
        params = {k: v for k, v in body.items() if k != "p_token"}
        return self._request(
            "POST",
            "/functions/v1/gtfs-import-api",
            {
                "action": action,
                "import_token": self.import_token,
                "params": params,
            },
            timeout=timeout,
            retries=retries,
        )

    def get_import_config(self) -> dict[str, Any]:
        result = self.rpc("get_gtfs_import_config", {
            "p_token": self.import_token,
        }, retries=2)
        if not isinstance(result, dict):
            raise RuntimeError("invalid_gtfs_import_config_response")
        return result

    def start_run(
        self, *, source_url: str, importer_version: str, config_sha256: str,
        active_before: str | None, metadata: dict[str, Any],
    ) -> str:
        result = self.rpc("start_gtfs_import_run", {
            "p_token": self.import_token,
            "p_source_url": source_url,
            "p_importer_version": importer_version,
            "p_config_sha256": config_sha256,
            "p_active_before": active_before,
            "p_metadata": metadata,
        })
        if not result:
            raise RuntimeError("gtfs_import_run_start_failed")
        return str(result)

    def update_run(self, run_id: str, patch: dict[str, Any]) -> None:
        ok = self.rpc("update_gtfs_import_run", {
            "p_token": self.import_token,
            "p_run_id": run_id,
            "p_patch": patch,
        }, retries=2)
        if not ok:
            raise RuntimeError("gtfs_import_run_update_failed")

    def previous_http_state(self, source_url: str, config_sha256: str) -> dict[str, Any]:
        result = self.rpc("get_gtfs_import_http_state", {
            "p_token": self.import_token,
            "p_source_url": source_url,
            "p_config_sha256": config_sha256,
        }, retries=2)
        return result if isinstance(result, dict) else {}

    def begin_import(self, *, version: str, sha256: str, source_url: str,
                     feed_start: str | None, feed_end: str | None, metadata: dict[str, Any]) -> dict[str, Any]:
        return self.rpc("begin_gtfs_import", {
            "p_token": self.import_token,
            "p_version": version,
            "p_label": FEED_LABEL,
            "p_sha256": sha256,
            "p_source_url": source_url,
            "p_feed_start_date": feed_start,
            "p_feed_end_date": feed_end,
            "p_metadata": metadata,
        }, retries=2)

    def import_batch(self, version: str, kind: str, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        result = self.rpc("import_gtfs_batch", {
            "p_token": self.import_token,
            "p_version": version,
            "p_kind": kind,
            "p_rows": rows,
        }, retries=3)
        return int(result)

    def validate_staging(self, version: str) -> dict[str, Any]:
        return self.rpc("validate_gtfs_import", {
            "p_token": self.import_token,
            "p_version": version,
        }, retries=1)

    def finalize(self, version: str) -> dict[str, Any]:
        # Finalize is intentionally not blindly retried. If the response is lost
        # after commit, the caller reconciles against the actual active feed state.
        return self.rpc("finalize_gtfs_import", {
            "p_token": self.import_token,
            "p_version": version,
        }, timeout=60)

    def feed_state(self, version: str) -> dict[str, Any] | None:
        result = self.rpc("get_gtfs_feed_state", {
            "p_token": self.import_token,
            "p_version": version,
        }, retries=2)
        return result if isinstance(result, dict) else None

    def claim_import_lock(self, owner: str, ttl_seconds: int = 2700) -> dict[str, Any] | None:
        result = self.rpc("claim_gtfs_import_worker", {
            "p_token": self.import_token,
            "p_owner": owner,
            "p_ttl_seconds": ttl_seconds,
        })
        if isinstance(result, list):
            return result[0] if result else None
        return result or None

    def release_import_lock(self, lock_id: str) -> bool:
        return bool(self.rpc("release_gtfs_import_worker", {
            "p_token": self.import_token,
            "p_lock_id": lock_id,
        }, retries=2))

    def abort_import(self, version: str) -> bool:
        return bool(self.rpc("abort_gtfs_import", {
            "p_token": self.import_token,
            "p_version": version,
        }, retries=1))


@dataclass(frozen=True)
class Target:
    target_id: str
    canonical_stop_id: str | None
    expected_name: str
    expected_lat: float
    expected_lon: float
    fallback_radius_m: int


@dataclass(frozen=True)
class RouteConfig:
    route_id: str
    route_name: str | None
    collection_scope: str


@dataclass(frozen=True)
class DownloadResult:
    sha256: str | None
    size: int
    last_modified: str | None
    etag: str | None
    not_modified: bool = False


class FeedReader:
    def __init__(self, path: Path):
        self.path = path
        self.zf = zipfile.ZipFile(path)
        self.members: dict[str, zipfile.ZipInfo] = {}
        for info in self.zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if name in self.members:
                raise RuntimeError(f"duplicate_gtfs_member:{name}")
            self.members[name] = info
        self._validate_archive()

    def close(self) -> None:
        self.zf.close()

    def _validate_archive(self) -> None:
        names = set(self.members)
        missing = REQUIRED_FILES - names
        if missing:
            raise RuntimeError(f"gtfs_missing_files:{','.join(sorted(missing))}")
        if not ({"calendar.txt", "calendar_dates.txt"} & names):
            raise RuntimeError("gtfs_missing_calendar_and_calendar_dates")
        total = 0
        for info in self.zf.infolist():
            p = Path(info.filename)
            if p.is_absolute() or ".." in p.parts:
                raise RuntimeError(f"unsafe_zip_path:{info.filename}")
            total += info.file_size
        if total > MAX_UNCOMPRESSED_BYTES:
            raise RuntimeError(f"gtfs_uncompressed_too_large:{total}")

    def has(self, name: str) -> bool:
        return name in self.members

    def rows(self, name: str) -> Iterator[dict[str, str]]:
        if name not in self.members:
            return iter(())
        binary = self.zf.open(self.members[name], "r")
        text = io.TextIOWrapper(binary, encoding="utf-8-sig", newline="")
        reader = csv.DictReader(text)
        if not reader.fieldnames:
            text.close()
            raise RuntimeError(f"gtfs_empty_header:{name}")
        actual_columns = {str(x).strip() for x in reader.fieldnames if x is not None}
        required_columns = REQUIRED_COLUMNS.get(name, set())
        missing_columns = required_columns - actual_columns
        if missing_columns:
            text.close()
            raise RuntimeError(
                f"gtfs_missing_columns:{name}:{','.join(sorted(missing_columns))}"
            )

        def iterator() -> Iterator[dict[str, str]]:
            try:
                for row in reader:
                    yield {str(k): (v if v is not None else "") for k, v in row.items() if k is not None}
            finally:
                text.close()
        return iterator()


def download(
    url: str,
    destination: Path,
    *,
    if_modified_since: str | None = None,
    if_none_match: str | None = None,
    retries: int = 2,
) -> DownloadResult:
    headers = {
        "User-Agent": IMPORTER_VERSION,
        "Accept": "application/zip,*/*",
    }
    if if_modified_since:
        headers["If-Modified-Since"] = if_modified_since
    if if_none_match:
        headers["If-None-Match"] = if_none_match

    retryable_statuses = {408, 425, 429, 500, 502, 503, 504}
    for attempt in range(retries + 1):
        digest = hashlib.sha256()
        total = 0
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as response, destination.open("wb") as out:
                last_modified = response.headers.get("Last-Modified")
                etag = response.headers.get("ETag")
                length = response.headers.get("Content-Length")
                if length and int(length) > MAX_ARCHIVE_BYTES:
                    raise RuntimeError(f"gtfs_download_too_large:{length}")
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > MAX_ARCHIVE_BYTES:
                        raise RuntimeError(f"gtfs_download_too_large:{total}")
                    digest.update(block)
                    out.write(block)
        except urllib.error.HTTPError as exc:
            if exc.code == 304:
                return DownloadResult(
                    sha256=None,
                    size=0,
                    last_modified=if_modified_since,
                    etag=if_none_match,
                    not_modified=True,
                )
            detail = exc.read().decode("utf-8", "replace")[:500]
            if exc.code not in retryable_statuses or attempt >= retries:
                raise RuntimeError(f"gtfs_download_http_{exc.code}:{detail}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt >= retries:
                reason = getattr(exc, "reason", exc)
                raise RuntimeError(f"gtfs_download_failed:{reason}") from exc
        else:
            if total == 0:
                raise RuntimeError("gtfs_download_empty")
            return DownloadResult(
                sha256=digest.hexdigest(),
                size=total,
                last_modified=last_modified,
                etag=etag,
                not_modified=False,
            )
        destination.unlink(missing_ok=True)
        time.sleep(2 ** attempt)

    raise RuntimeError("gtfs_download_failed:retry_exhausted")


def batch(iterable: Iterable[dict[str, Any]], size: int = BATCH_SIZE) -> Iterator[list[dict[str, Any]]]:
    buf: list[dict[str, Any]] = []
    for item in iterable:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def target_name_matches(expected: str, actual: str) -> bool:
    expected_tokens = set(normalize_name(expected).split())
    actual_tokens = set(normalize_name(actual).split())
    if not expected_tokens or not actual_tokens:
        return False
    if normalize_name(expected) == normalize_name(actual):
        return True
    overlap = expected_tokens & actual_tokens
    if len(expected_tokens) == 1:
        return expected_tokens <= actual_tokens
    return len(overlap) >= 2 and len(overlap) / len(expected_tokens) >= 0.5


def resolve_targets(stops: dict[str, dict[str, Any]], targets: list[Target]) -> tuple[set[str], list[dict[str, Any]]]:
    resolved: set[str] = set()
    audit: list[dict[str, Any]] = []
    for target in targets:
        exact = stops.get(target.canonical_stop_id or "")
        if exact:
            lat = exact.get("stop_lat")
            lon = exact.get("stop_lon")
            if lat is None or lon is None:
                raise RuntimeError(f"target_missing_coordinates:{target.target_id}:{target.canonical_stop_id}")
            distance = haversine_m(target.expected_lat, target.expected_lon, float(lat), float(lon))
            if distance > max(250, target.fallback_radius_m):
                raise RuntimeError(f"target_exact_id_moved:{target.target_id}:{distance:.0f}m")
            resolved.add(str(exact["stop_id"]))
            audit.append({"target_id": target.target_id, "stop_id": exact["stop_id"], "match": "exact_id", "distance_m": round(distance, 1)})
            continue

        candidates: list[tuple[float, dict[str, Any]]] = []
        for stop in stops.values():
            lat = stop.get("stop_lat")
            lon = stop.get("stop_lon")
            if lat is None or lon is None:
                continue
            distance = haversine_m(target.expected_lat, target.expected_lon, float(lat), float(lon))
            if distance > target.fallback_radius_m:
                continue
            if not target_name_matches(target.expected_name, str(stop.get("stop_name") or "")):
                continue
            candidates.append((distance, stop))
        candidates.sort(key=lambda x: x[0])
        if not candidates:
            raise RuntimeError(f"target_not_found:{target.target_id}")
        if len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 25:
            raise RuntimeError(f"target_ambiguous:{target.target_id}")
        distance, stop = candidates[0]
        resolved.add(str(stop["stop_id"]))
        audit.append({"target_id": target.target_id, "stop_id": stop["stop_id"], "match": "coordinate_fallback", "distance_m": round(distance, 1)})
    if len(resolved) != len(targets):
        raise RuntimeError("target_collision")
    return resolved, audit


def collect_stops(feed: FeedReader) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for r in feed.rows("stops.txt"):
        stop_id = r.get("stop_id", "").strip()
        if not stop_id:
            raise RuntimeError("invalid_stop_row:missing_stop_id")
        if stop_id in result:
            raise RuntimeError(f"duplicate_stop_id:{stop_id}")
        result[stop_id] = {
            "stop_id": stop_id,
            "stop_code": r.get("stop_code") or None,
            "stop_name": r.get("stop_name") or "",
            "stop_desc": r.get("stop_desc") or None,
            "stop_lat": parse_float(r.get("stop_lat")),
            "stop_lon": parse_float(r.get("stop_lon")),
            "zone_id": r.get("zone_id") or None,
            "stop_url": r.get("stop_url") or None,
            "location_type": parse_int(r.get("location_type")),
            "parent_station": r.get("parent_station") or None,
        }
    return result


def collect_routes(feed: FeedReader, configs: dict[str, RouteConfig]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for r in feed.rows("routes.txt"):
        route_id = r.get("route_id", "").strip()
        if route_id not in configs:
            continue
        if route_id in result:
            raise RuntimeError(f"duplicate_route_id:{route_id}")
        result[route_id] = {
            "route_id": route_id,
            "agency_id": r.get("agency_id") or None,
            "route_short_name": r.get("route_short_name") or None,
            "route_long_name": r.get("route_long_name") or None,
            "route_type": parse_int(r.get("route_type")),
            "route_desc": r.get("route_desc") or None,
            "route_url": r.get("route_url") or None,
            "route_color": r.get("route_color") or None,
            "route_text_color": r.get("route_text_color") or None,
        }
    missing = set(configs) - set(result)
    if missing:
        raise RuntimeError(f"configured_routes_missing:{','.join(sorted(missing))}")
    return result


def collect_trips(feed: FeedReader, routes: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    enabled_routes = set(routes)
    for r in feed.rows("trips.txt"):
        route_id = r.get("route_id", "").strip()
        if route_id not in enabled_routes:
            continue
        trip_id = r.get("trip_id", "").strip()
        service_id = r.get("service_id", "").strip()
        if not trip_id or not service_id:
            raise RuntimeError(f"invalid_trip_row:{route_id}:missing_trip_or_service")
        if trip_id in result:
            raise RuntimeError(f"duplicate_trip_id:{trip_id}")
        result[trip_id] = {
            "trip_id": trip_id,
            "route_id": route_id,
            "service_id": service_id,
            "trip_headsign": r.get("trip_headsign") or None,
            "trip_short_name": r.get("trip_short_name") or None,
            "direction_id": parse_int(r.get("direction_id")),
            "block_id": r.get("block_id") or None,
            "shape_id": r.get("shape_id") or None,
        }
    if not result:
        raise RuntimeError("no_trips_for_enabled_routes")
    return result


def spool_stop_times(feed: FeedReader, trips: dict[str, dict[str, Any]], db: sqlite3.Connection) -> None:
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.execute("PRAGMA temp_store=MEMORY")
    db.execute("""create table st(
        trip_id text not null,
        stop_sequence integer not null,
        stop_id text not null,
        arrival_seconds integer,
        departure_seconds integer,
        pickup_type integer,
        drop_off_type integer,
        stop_headsign text,
        timepoint integer,
        primary key(trip_id,stop_sequence)
    ) without rowid""")
    trip_ids = set(trips)
    buffer: list[tuple[Any, ...]] = []
    for r in feed.rows("stop_times.txt"):
        trip_id = r.get("trip_id", "").strip()
        if trip_id not in trip_ids:
            continue
        seq = parse_int(r.get("stop_sequence"))
        stop_id = r.get("stop_id", "").strip()
        if seq is None or not stop_id:
            raise RuntimeError(f"invalid_stop_time_row:{trip_id}:missing_sequence_or_stop")
        buffer.append((
            trip_id, seq, stop_id, gtfs_seconds(r.get("arrival_time")), gtfs_seconds(r.get("departure_time")),
            parse_int(r.get("pickup_type")), parse_int(r.get("drop_off_type")),
            r.get("stop_headsign") or None, parse_int(r.get("timepoint")),
        ))
        if len(buffer) >= 5000:
            db.executemany("insert into st values(?,?,?,?,?,?,?,?,?)", buffer)
            buffer.clear()
    if buffer:
        db.executemany("insert into st values(?,?,?,?,?,?,?,?,?)", buffer)
    db.execute("create index st_stop_idx on st(stop_id,trip_id)")
    db.commit()


def select_trips(db: sqlite3.Connection, trips: dict[str, dict[str, Any]], configs: dict[str, RouteConfig], monitored: set[str]) -> set[str]:
    selected = {tid for tid, t in trips.items() if configs[t["route_id"]].collection_scope == "all_trips"}
    if monitored:
        placeholders = ",".join("?" for _ in monitored)
        for (trip_id,) in db.execute(f"select distinct trip_id from st where stop_id in ({placeholders})", tuple(sorted(monitored))):
            trip = trips.get(trip_id)
            if trip and configs[trip["route_id"]].collection_scope == "local_trips":
                selected.add(trip_id)
    if not selected:
        raise RuntimeError("no_selected_trips")
    return selected


def selected_stop_times(db: sqlite3.Connection, selected: set[str], monitored: set[str]) -> Iterator[dict[str, Any]]:
    db.execute("create temp table selected_trips(trip_id text primary key)")
    db.executemany("insert into selected_trips(trip_id) values(?)", ((x,) for x in selected))
    for row in db.execute("""
        select st.trip_id,st.stop_sequence,st.stop_id,st.arrival_seconds,st.departure_seconds,
               st.pickup_type,st.drop_off_type,st.stop_headsign,st.timepoint
        from st join selected_trips s using(trip_id)
        order by st.trip_id,st.stop_sequence
    """):
        yield {
            "trip_id": row[0], "stop_sequence": row[1], "stop_id": row[2],
            "arrival_seconds": row[3], "departure_seconds": row[4],
            "pickup_type": row[5], "drop_off_type": row[6],
            "stop_headsign": row[7], "timepoint": row[8],
            "monitored": row[2] in monitored,
        }


def feed_info(feed: FeedReader) -> dict[str, Any]:
    rows = list(feed.rows("feed_info.txt"))
    if len(rows) != 1:
        raise RuntimeError(f"feed_info_row_count:{len(rows)}")
    r = rows[0]
    return {
        "feed_publisher_name": r.get("feed_publisher_name") or "National Transport Authority",
        "feed_publisher_url": r.get("feed_publisher_url") or None,
        "feed_lang": r.get("feed_lang") or None,
        "feed_start_date": parse_gtfs_date(r.get("feed_start_date")),
        "feed_end_date": parse_gtfs_date(r.get("feed_end_date")),
        "feed_version": r.get("feed_version") or None,
        "feed_contact_email": r.get("feed_contact_email") or None,
    }


def feed_window_state(info: dict[str, Any], today: date | None = None) -> tuple[str, date, date, date]:
    today = today or datetime.now(DUBLIN_TZ).date()
    start_raw = info.get("feed_start_date")
    end_raw = info.get("feed_end_date")
    if not start_raw or not end_raw:
        raise RuntimeError("feed_info_missing_date_window")
    try:
        start = date.fromisoformat(str(start_raw))
        end = date.fromisoformat(str(end_raw))
    except ValueError as exc:
        raise RuntimeError("feed_info_invalid_date_window") from exc
    if start > end:
        raise RuntimeError("feed_info_reversed_date_window")
    if today < start:
        return "future", today, start, end
    if today > end:
        return "expired", today, start, end
    return "current", today, start, end


def validate_feed_window(info: dict[str, Any], today: date | None = None) -> None:
    state, current, start, end = feed_window_state(info, today)
    if state != "current":
        raise RuntimeError(
            f"feed_not_current:today={current.isoformat()}:start={start.isoformat()}:end={end.isoformat()}"
        )


def selected_agencies(feed: FeedReader, agency_ids: set[str]) -> Iterator[dict[str, Any]]:
    for r in feed.rows("agency.txt"):
        agency_id = r.get("agency_id", "").strip()
        # GTFS permits omitted agency_id when there is exactly one agency. NTA uses IDs,
        # but keep a conservative fallback for a single-agency feed.
        if agency_ids and agency_id not in agency_ids:
            continue
        yield {
            "agency_id": agency_id or "default",
            "agency_name": r.get("agency_name") or "Unknown agency",
            "agency_url": r.get("agency_url") or None,
            "agency_timezone": r.get("agency_timezone") or None,
        }


def selected_calendars(feed: FeedReader, service_ids: set[str]) -> Iterator[dict[str, Any]]:
    if not feed.has("calendar.txt"):
        return
    for r in feed.rows("calendar.txt"):
        if r.get("service_id") not in service_ids:
            continue
        yield {
            "service_id": r.get("service_id"),
            "monday": parse_bool01(r.get("monday")), "tuesday": parse_bool01(r.get("tuesday")),
            "wednesday": parse_bool01(r.get("wednesday")), "thursday": parse_bool01(r.get("thursday")),
            "friday": parse_bool01(r.get("friday")), "saturday": parse_bool01(r.get("saturday")),
            "sunday": parse_bool01(r.get("sunday")),
            "start_date": parse_gtfs_date(r.get("start_date")),
            "end_date": parse_gtfs_date(r.get("end_date")),
        }


def selected_calendar_dates(feed: FeedReader, service_ids: set[str]) -> Iterator[dict[str, Any]]:
    if not feed.has("calendar_dates.txt"):
        return
    for r in feed.rows("calendar_dates.txt"):
        if r.get("service_id") not in service_ids:
            continue
        yield {
            "service_id": r.get("service_id"),
            "service_date": parse_gtfs_date(r.get("date")),
            "exception_type": parse_int(r.get("exception_type")),
        }


def selected_shapes(feed: FeedReader, shape_ids: set[str]) -> Iterator[dict[str, Any]]:
    for r in feed.rows("shapes.txt"):
        if r.get("shape_id") not in shape_ids:
            continue
        lat = parse_float(r.get("shape_pt_lat")); lon = parse_float(r.get("shape_pt_lon")); seq = parse_int(r.get("shape_pt_sequence"))
        if lat is None or lon is None or seq is None:
            raise RuntimeError(f"invalid_shape_row:{r.get('shape_id')}")
        yield {
            "shape_id": r.get("shape_id"), "shape_pt_lat": lat, "shape_pt_lon": lon,
            "shape_pt_sequence": seq, "shape_dist_traveled": parse_float(r.get("shape_dist_traveled")),
        }


def selected_translations(feed: FeedReader, selected_ids: set[str], selected_values: set[str]) -> Iterator[dict[str, Any]]:
    if not feed.has("translations.txt"):
        return
    for r in feed.rows("translations.txt"):
        record_id = r.get("record_id") or None
        field_value = r.get("field_value") or None
        if record_id and record_id not in selected_ids:
            continue
        if not record_id and field_value and field_value not in selected_values:
            continue
        if not record_id and not field_value:
            continue
        yield {
            "table_name": r.get("table_name") or "",
            "field_name": r.get("field_name") or "",
            "language": r.get("language") or "",
            "translation": r.get("translation") or "",
            "record_id": record_id,
            "field_value": field_value,
        }



def service_active_on(
    service_id: str,
    day: date,
    calendar_by_service: dict[str, dict[str, Any]],
    exceptions: dict[tuple[str, date], int],
) -> bool:
    exception = exceptions.get((service_id, day))
    if exception == 1:
        return True
    if exception == 2:
        return False
    row = calendar_by_service.get(service_id)
    if not row:
        return False
    start = date.fromisoformat(str(row["start_date"]))
    end = date.fromisoformat(str(row["end_date"]))
    if not (start <= day <= end):
        return False
    weekday = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][day.weekday()]
    return bool(row.get(weekday))


def validate_upcoming_target_service(
    *,
    monitored_stop_ids: set[str],
    chosen_trip_rows: list[dict[str, Any]],
    stop_times_rows: list[dict[str, Any]],
    calendar_rows: list[dict[str, Any]],
    calendar_date_rows: list[dict[str, Any]],
    today: date | None = None,
    horizon_days: int = 7,
) -> None:
    today = today or datetime.now(DUBLIN_TZ).date()
    trip_service = {str(t["trip_id"]): str(t["service_id"]) for t in chosen_trip_rows}
    services_by_stop: dict[str, set[str]] = {sid: set() for sid in monitored_stop_ids}
    for st in stop_times_rows:
        stop_id = str(st["stop_id"])
        if stop_id not in services_by_stop:
            continue
        service_id = trip_service.get(str(st["trip_id"]))
        if service_id:
            services_by_stop[stop_id].add(service_id)
        if st.get("arrival_seconds") is None and st.get("departure_seconds") is None:
            raise RuntimeError(f"monitored_stop_time_missing_time:{st['trip_id']}:{stop_id}:{st.get('stop_sequence')}")

    calendar_by_service = {str(r["service_id"]): r for r in calendar_rows}
    exceptions: dict[tuple[str, date], int] = {}
    for r in calendar_date_rows:
        if not r.get("service_date") or r.get("exception_type") is None:
            continue
        exceptions[(str(r["service_id"]), date.fromisoformat(str(r["service_date"])))] = int(r["exception_type"])

    missing: list[str] = []
    for stop_id, service_ids in services_by_stop.items():
        covered = False
        for offset in range(horizon_days + 1):
            day = date.fromordinal(today.toordinal() + offset)
            if any(service_active_on(sid, day, calendar_by_service, exceptions) for sid in service_ids):
                covered = True
                break
        if not covered:
            missing.append(stop_id)
    if missing:
        raise RuntimeError("monitored_target_no_service_next_7_days:" + ",".join(sorted(missing)))


def validate_subset(
    *,
    selected_routes: list[dict[str, Any]],
    selected_stops: list[dict[str, Any]],
    chosen_trip_rows: list[dict[str, Any]],
    stop_times_rows: list[dict[str, Any]],
    agency_rows: list[dict[str, Any]],
    calendar_rows: list[dict[str, Any]],
    calendar_date_rows: list[dict[str, Any]],
    shape_rows: list[dict[str, Any]],
) -> None:
    if not selected_routes or not selected_stops or not chosen_trip_rows or not stop_times_rows:
        raise RuntimeError("empty_selected_gtfs_subset")

    route_ids = {str(r["route_id"]) for r in selected_routes}
    trip_ids = {str(t["trip_id"]) for t in chosen_trip_rows}
    stop_ids = {str(s["stop_id"]) for s in selected_stops}
    service_ids = {str(t["service_id"]) for t in chosen_trip_rows}
    agency_ids = {str(r["agency_id"]) for r in selected_routes if r.get("agency_id")}
    shape_ids = {str(t["shape_id"]) for t in chosen_trip_rows if t.get("shape_id")}

    bad_trip_routes = {str(t["route_id"]) for t in chosen_trip_rows} - route_ids
    if bad_trip_routes:
        raise RuntimeError("selected_trip_route_missing:" + ",".join(sorted(bad_trip_routes)))

    bad_stop_refs = {str(st["stop_id"]) for st in stop_times_rows} - stop_ids
    if bad_stop_refs:
        raise RuntimeError("selected_stop_missing:" + ",".join(sorted(bad_stop_refs)))

    counts: dict[str, int] = {trip_id: 0 for trip_id in trip_ids}
    unknown_trip_refs: set[str] = set()
    for st in stop_times_rows:
        trip_id = str(st["trip_id"])
        if trip_id not in counts:
            unknown_trip_refs.add(trip_id)
            continue
        counts[trip_id] += 1
    if unknown_trip_refs:
        raise RuntimeError("selected_stop_time_trip_missing:" + ",".join(sorted(unknown_trip_refs)))
    short_trips = sorted(t for t, count in counts.items() if count < 2)
    if short_trips:
        raise RuntimeError("selected_trip_has_fewer_than_two_stops:" + ",".join(short_trips[:20]))

    calendar_service_ids = {str(r["service_id"]) for r in calendar_rows}
    calendar_service_ids.update(str(r["service_id"]) for r in calendar_date_rows)
    missing_services = service_ids - calendar_service_ids
    if missing_services:
        raise RuntimeError("selected_service_calendar_missing:" + ",".join(sorted(missing_services)))

    imported_agency_ids = {str(r["agency_id"]) for r in agency_rows}
    missing_agencies = agency_ids - imported_agency_ids
    if missing_agencies:
        raise RuntimeError("selected_agency_missing:" + ",".join(sorted(missing_agencies)))

    imported_shape_ids = {str(r["shape_id"]) for r in shape_rows}
    missing_shapes = shape_ids - imported_shape_ids
    if missing_shapes:
        raise RuntimeError("selected_shape_missing:" + ",".join(sorted(missing_shapes)))

def import_rows(sb: Supabase, version: str, kind: str, rows: Iterable[dict[str, Any]]) -> int:
    total = 0
    for chunk in batch(rows):
        total += sb.import_batch(version, kind, chunk)
    return total


def load_config(sb: Supabase) -> tuple[list[Target], dict[str, RouteConfig], str | None]:
    config = sb.get_import_config()
    target_rows = config.get("targets") or []
    route_rows = config.get("routes") or []
    active_version = config.get("active_version")
    targets = [Target(
        target_id=str(x["target_id"]),
        canonical_stop_id=x.get("canonical_stop_id"),
        expected_name=str(x["expected_name"]),
        expected_lat=float(x["expected_lat"]),
        expected_lon=float(x["expected_lon"]),
        fallback_radius_m=int(x["fallback_radius_m"]),
    ) for x in target_rows]
    routes = {
        str(x["route_id"]): RouteConfig(
            str(x["route_id"]),
            x.get("route_name"),
            str(x.get("collection_scope") or "local_trips"),
        )
        for x in route_rows
    }
    if not targets:
        raise RuntimeError("no_enabled_gtfs_import_targets")
    if not routes:
        raise RuntimeError("no_enabled_regional_routes")
    return targets, routes, (str(active_version) if active_version else None)


def run(args: argparse.Namespace) -> dict[str, Any]:
    api_key = (
        os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    )
    if not api_key:
        raise RuntimeError("missing_environment:SUPABASE_PUBLISHABLE_KEY")
    sb = Supabase(
        env_required("SUPABASE_URL"),
        api_key,
        env_required("GTFS_IMPORT_TOKEN"),
    )
    owner = f"{IMPORTER_VERSION}:pid={os.getpid()}"
    lock = sb.claim_import_lock(owner)
    if not lock:
        return {"status": "busy", "reason": "another_gtfs_import_is_running"}

    lock_id = str(lock["lock_id"])
    run_id: str | None = None
    staged_version: str | None = None

    try:
        targets, configs, active_before = load_config(sb)
        config_doc = {
            "targets": [t.__dict__ for t in targets],
            "routes": [r.__dict__ for r in sorted(configs.values(), key=lambda x: x.route_id)],
            "importer_version": IMPORTER_VERSION,
        }
        config_sha = hashlib.sha256(canonical_json(config_doc)).hexdigest()

        run_id = sb.start_run(
            source_url=args.url,
            importer_version=IMPORTER_VERSION,
            config_sha256=config_sha,
            active_before=active_before,
            metadata={
                "pid": os.getpid(),
                "lock_id": lock_id,
                "dry_run": bool(args.dry_run),
                "force_download": bool(args.force),
            },
        )

        with tempfile.TemporaryDirectory(prefix="ballina-gtfs-") as tmpdir:
            zip_path = Path(tmpdir) / "gtfs.zip"

            # Conditional requests are only safe when the previous accepted run used
            # the same importer configuration. A dry-run deliberately downloads the
            # full archive so it actually validates the current source.
            previous: dict[str, Any] = {}
            if not args.force and not args.dry_run:
                previous = sb.previous_http_state(args.url, config_sha)

            downloaded = download(
                args.url,
                zip_path,
                if_modified_since=previous.get("source_last_modified"),
                if_none_match=previous.get("source_etag"),
            )

            if downloaded.not_modified:
                sb.update_run(run_id, {
                    "status": "unchanged",
                    "completed_at": utcnow_iso(),
                    "source_last_modified": downloaded.last_modified,
                    "source_etag": downloaded.etag,
                    "active_after": active_before,
                    "metadata": {
                        "reason": "source_http_304_not_modified_same_config",
                        "config_sha256": config_sha,
                        "lock_id": lock_id,
                    },
                })
                return {
                    "status": "unchanged",
                    "reason": "source_http_304_not_modified_same_config",
                    "version": active_before,
                }

            if not downloaded.sha256:
                raise RuntimeError("gtfs_download_hash_missing")

            zip_sha = downloaded.sha256
            source_bytes = downloaded.size
            last_modified = downloaded.last_modified
            source_etag = downloaded.etag
            candidate_version = hashlib.sha256(
                f"{zip_sha}|{config_sha}|{IMPORTER_VERSION}".encode()
            ).hexdigest()

            sb.update_run(run_id, {
                "source_sha256": zip_sha,
                "version": candidate_version,
                "source_bytes": source_bytes,
                "source_last_modified": last_modified,
                "source_etag": source_etag,
            })

            if not args.dry_run:
                existing = sb.feed_state(candidate_version)
                if existing and bool(existing.get("active")):
                    sb.update_run(run_id, {
                        "status": "unchanged",
                        "completed_at": utcnow_iso(),
                        "active_after": candidate_version,
                        "metadata": {
                            "reason": "same_source_config_and_importer_already_active",
                            "lock_id": lock_id,
                        },
                    })
                    return {"status": "unchanged", "version": candidate_version}

            feed = FeedReader(zip_path)
            try:
                info = feed_info(feed)
                window_state, today, feed_start, feed_end = feed_window_state(info)
                if window_state == "future":
                    sb.update_run(run_id, {
                        "status": "deferred",
                        "completed_at": utcnow_iso(),
                        "active_after": active_before,
                        "metadata": {
                            "reason": "source_feed_starts_in_future",
                            "today": today.isoformat(),
                            "feed_start_date": feed_start.isoformat(),
                            "feed_end_date": feed_end.isoformat(),
                            "lock_id": lock_id,
                        },
                    })
                    return {
                        "status": "deferred",
                        "reason": "source_feed_starts_in_future",
                        "feed_start_date": feed_start.isoformat(),
                        "active_version": active_before,
                    }
                if window_state == "expired":
                    raise RuntimeError(
                        f"feed_expired:today={today.isoformat()}:start={feed_start.isoformat()}:end={feed_end.isoformat()}"
                    )

                all_stops = collect_stops(feed)
                monitored, target_audit = resolve_targets(all_stops, targets)
                routes = collect_routes(feed, configs)
                trips = collect_trips(feed, routes)

                sqlite_path = Path(tmpdir) / "stop_times.sqlite3"
                db = sqlite3.connect(sqlite_path)
                try:
                    try:
                        spool_stop_times(feed, trips, db)
                    except sqlite3.IntegrityError as exc:
                        raise RuntimeError(f"duplicate_stop_time_key:{exc}") from exc
                    chosen = select_trips(db, trips, configs, monitored)
                    chosen_trip_rows = []
                    placeholders = ",".join("?" for _ in monitored)
                    monitored_params = tuple(sorted(monitored))
                    for trip_id in sorted(chosen):
                        t = dict(trips[trip_id])
                        t["passes_monitored"] = bool(db.execute(
                            f"select 1 from st where trip_id=? and stop_id in ({placeholders}) limit 1",
                            (trip_id, *monitored_params),
                        ).fetchone())
                        t["selected_by_route"] = (
                            configs[t["route_id"]].collection_scope == "all_trips"
                        )
                        chosen_trip_rows.append(t)

                    stop_times_rows = list(selected_stop_times(db, chosen, monitored))
                    referenced_stop_ids = {r["stop_id"] for r in stop_times_rows}
                    missing_monitored_targets = monitored - referenced_stop_ids
                    if missing_monitored_targets:
                        raise RuntimeError(
                            "monitored_target_not_served:"
                            + ",".join(sorted(missing_monitored_targets))
                        )
                    selected_stops = []
                    for sid in sorted(referenced_stop_ids):
                        if sid not in all_stops:
                            raise RuntimeError(f"referenced_stop_missing:{sid}")
                        stop = dict(all_stops[sid])
                        stop["monitored"] = sid in monitored
                        selected_stops.append(stop)
                finally:
                    db.close()

                selected_route_ids = {t["route_id"] for t in chosen_trip_rows}
                if selected_route_ids != set(configs):
                    missing_selected_routes = sorted(set(configs) - selected_route_ids)
                    raise RuntimeError(
                        "enabled_route_has_no_selected_trips:"
                        + ",".join(missing_selected_routes)
                    )

                selected_routes = [routes[x] for x in sorted(selected_route_ids)]
                service_ids = {t["service_id"] for t in chosen_trip_rows}
                shape_ids = {t["shape_id"] for t in chosen_trip_rows if t.get("shape_id")}
                agency_ids = {
                    routes[r]["agency_id"]
                    for r in selected_route_ids
                    if routes[r].get("agency_id")
                }
                agency_rows = list(selected_agencies(
                    feed, {str(x) for x in agency_ids if x}
                ))
                calendar_rows = list(selected_calendars(feed, service_ids))
                calendar_date_rows = list(selected_calendar_dates(feed, service_ids))
                shape_rows = list(selected_shapes(feed, {str(x) for x in shape_ids}))

                selected_values = {
                    str(x) for x in selected_route_ids | referenced_stop_ids | chosen
                }
                selected_values.update(
                    str(x.get("route_short_name") or "") for x in selected_routes
                )
                selected_values.update(
                    str(x.get("route_long_name") or "") for x in selected_routes
                )
                selected_values.update(
                    str(x.get("stop_name") or "") for x in selected_stops
                )
                translation_rows = list(selected_translations(
                    feed,
                    selected_route_ids | referenced_stop_ids | chosen,
                    selected_values,
                ))

                validate_subset(
                    selected_routes=selected_routes,
                    selected_stops=selected_stops,
                    chosen_trip_rows=chosen_trip_rows,
                    stop_times_rows=stop_times_rows,
                    agency_rows=agency_rows,
                    calendar_rows=calendar_rows,
                    calendar_date_rows=calendar_date_rows,
                    shape_rows=shape_rows,
                )
                validate_upcoming_target_service(
                    monitored_stop_ids=monitored,
                    chosen_trip_rows=chosen_trip_rows,
                    stop_times_rows=stop_times_rows,
                    calendar_rows=calendar_rows,
                    calendar_date_rows=calendar_date_rows,
                )

                validation = {
                    "targets": target_audit,
                    "monitored_stop_ids": sorted(monitored),
                    "route_count": len(selected_routes),
                    "stop_count": len(selected_stops),
                    "trip_count": len(chosen_trip_rows),
                    "stop_time_count": len(stop_times_rows),
                    "shape_point_count": len(shape_rows),
                    "agency_count": len(agency_rows),
                    "calendar_count": len(calendar_rows),
                    "calendar_date_count": len(calendar_date_rows),
                    "translation_count": len(translation_rows),
                    "upcoming_service_horizon_days": 7,
                }
                sb.update_run(run_id, {
                    "status": "validated",
                    "route_count": len(selected_routes),
                    "stop_count": len(selected_stops),
                    "trip_count": len(chosen_trip_rows),
                    "stop_time_count": len(stop_times_rows),
                    "shape_point_count": len(shape_rows),
                    "monitored_stop_count": len(monitored),
                    "metadata": {**validation, "lock_id": lock_id},
                })

                staging_version = candidate_version
                if args.dry_run:
                    staging_version = hashlib.sha256(
                        f"{candidate_version}|dry-run|{run_id}".encode()
                    ).hexdigest()

                begin = sb.begin_import(
                    version=staging_version,
                    sha256=zip_sha,
                    source_url=args.url,
                    feed_start=info.get("feed_start_date"),
                    feed_end=info.get("feed_end_date"),
                    metadata={
                        "importer_version": IMPORTER_VERSION,
                        "config_sha256": config_sha,
                        "candidate_version": candidate_version,
                        "dry_run": bool(args.dry_run),
                        "target_matches": target_audit,
                        "source_last_modified": last_modified,
                        "source_etag": source_etag,
                        "source_bytes": source_bytes,
                    },
                )
                if begin.get("exists") and begin.get("active"):
                    if args.dry_run:
                        raise RuntimeError("dry_run_staging_version_unexpectedly_active")
                    sb.update_run(run_id, {
                        "status": "unchanged",
                        "completed_at": utcnow_iso(),
                        "active_after": candidate_version,
                        "metadata": {
                            **validation,
                            "reason": "same_source_and_config_already_active",
                            "lock_id": lock_id,
                        },
                    })
                    return {"status": "unchanged", "version": candidate_version, **validation}

                staged_version = staging_version
                sb.update_run(run_id, {
                    "status": "importing"
                })

                counts: dict[str, int] = {}
                counts["agencies"] = import_rows(sb, staging_version, "agencies", agency_rows)
                counts["feed_info"] = import_rows(sb, staging_version, "feed_info", [info])
                counts["routes"] = import_rows(sb, staging_version, "routes", selected_routes)
                counts["stops"] = import_rows(sb, staging_version, "stops", selected_stops)
                counts["trips"] = import_rows(sb, staging_version, "trips", chosen_trip_rows)
                counts["stop_times"] = import_rows(sb, staging_version, "stop_times", stop_times_rows)
                counts["calendars"] = import_rows(sb, staging_version, "calendars", calendar_rows)
                counts["calendar_dates"] = import_rows(
                    sb, staging_version, "calendar_dates", calendar_date_rows
                )
                counts["shapes"] = import_rows(sb, staging_version, "shapes", shape_rows)
                counts["translations"] = import_rows(
                    sb, staging_version, "translations", translation_rows
                )

                db_validation = sb.validate_staging(staging_version)

                if args.dry_run:
                    aborted = sb.abort_import(staging_version)
                    staged_version = None
                    if not aborted:
                        raise RuntimeError("dry_run_staging_cleanup_failed")
                    sb.update_run(run_id, {
                        "status": "validated",
                        "completed_at": utcnow_iso(),
                        "active_after": active_before,
                        "metadata": {
                            **validation,
                            "dry_run": True,
                            "candidate_version": candidate_version,
                            "database_validation": db_validation,
                            "imported_rows": counts,
                            "staging_cleaned": True,
                            "lock_id": lock_id,
                        },
                    })
                    return {
                        "status": "dry_run_ok",
                        "version": candidate_version,
                        "database_validation": db_validation,
                        "imported_rows": counts,
                        **validation,
                    }

                try:
                    finalized = sb.finalize(staging_version)
                except Exception as finalize_exc:
                    state = sb.feed_state(staging_version)
                    if state and bool(state.get("active")):
                        staged_version = None
                        sb.update_run(run_id, {
                            "status": "activated",
                            "completed_at": utcnow_iso(),
                            "active_after": candidate_version,
                            "metadata": {
                                **validation,
                                "imported_rows": counts,
                                "database_validation": db_validation,
                                "finalize_reconciled_after_error": True,
                                "finalize_error": str(finalize_exc)[:500],
                                "lock_id": lock_id,
                            },
                        })
                        return {
                            "status": "activated_reconciled",
                            "version": candidate_version,
                            "imported_rows": counts,
                            "database_validation": db_validation,
                        }
                    raise

                staged_version = None
                sb.update_run(run_id, {
                    "status": "activated",
                    "completed_at": utcnow_iso(),
                    "active_after": candidate_version,
                    "metadata": {
                        **validation,
                        "imported_rows": counts,
                        "database_validation": db_validation,
                        "finalize": finalized,
                        "lock_id": lock_id,
                    },
                })
                return {
                    "status": "activated",
                    "version": candidate_version,
                    "imported_rows": counts,
                    "database_validation": db_validation,
                    "finalize": finalized,
                }
            finally:
                feed.close()
    except Exception as exc:
        # Never blindly abort a version after an ambiguous finalize failure.
        # Reconcile against the real database state first.
        if staged_version:
            try:
                state = sb.feed_state(staged_version)
            except Exception:
                state = None
            if state and bool(state.get("active")):
                if run_id:
                    try:
                        sb.update_run(run_id, {
                            "status": "activated",
                            "completed_at": utcnow_iso(),
                            "active_after": staged_version,
                            "metadata": {
                                "finalize_reconciled_after_outer_error": True,
                                "error": str(exc)[:500],
                                "lock_id": lock_id,
                            },
                        })
                    except Exception:
                        pass
                return {
                    "status": "activated_reconciled",
                    "version": staged_version,
                    "warning": str(exc)[:500],
                }
            try:
                sb.abort_import(staged_version)
            except Exception:
                pass
        if run_id:
            try:
                sb.update_run(run_id, {
                    "status": "failed",
                    "completed_at": utcnow_iso(),
                    "error_code": str(exc)[:500],
                })
            except Exception:
                pass
        raise
    finally:
        try:
            sb.release_import_lock(lock_id)
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("GTFS_URL", DEFAULT_GTFS_URL))
    parser.add_argument("--dry-run", action="store_true", help="Stage, database-validate, then delete without activation")
    parser.add_argument("--force", action="store_true", help="Ignore HTTP validators and download the full source archive")
    args = parser.parse_args()
    try:
        result = run(args)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
