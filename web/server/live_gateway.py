"""Read-only same-origin transport gateway. Never serves checkout or credentials."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import http.server
import hashlib
import hmac
import ipaddress
import secrets
import subprocess
from collections import deque
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
TRANSPORT_URL = "https://giwiqbnyozjbpmetrjhe.supabase.co/functions/v1/transport-api"
RAIL_URL = "https://api.irishrail.ie/realtime/realtime.asmx/getCurrentTrainsXML"
JOURNEY_URL = "https://giwiqbnyozjbpmetrjhe.supabase.co/functions/v1/journey-api"
MAX_BODY = 1_048_576
MAX_GPS_AGE = 180
ROOT = Path(__file__).resolve().parents[1] / "dist"
CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


def stamp(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(UTC) if parsed.tzinfo else None
    except ValueError:
        return None


def iso(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def text(value, limit=160):
    return "".join(c for c in str(value or "") if c >= " " and c != "\x7f")[:limit]


def coordinate(lat, lon):
    if isinstance(lat, bool) or isinstance(lon, bool):
        return None
    try:
        lat, lon = float(lat), float(lon)
        if math.isfinite(lat) and math.isfinite(lon) and 51 <= lat <= 55.7 and -11 <= lon <= -5:
            return lat, lon
    except (TypeError, ValueError, OverflowError):
        pass
    return None


def reported_bus_service(row):
    """Public RPC references, not proof of feed/service-date/stop linkage."""
    def identifier(name):
        value = row.get(name)
        return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_ .:-]{1,120}", value) else None
    operator = row.get("operator_name")
    operator = operator if isinstance(operator, str) and 1 <= len(operator) <= 160 and not re.search(r"[\x00-\x1f\x7f]", operator) else None
    mapping = row.get("mapping_status")
    mapping = mapping if mapping in {"exact_trip", "route_only", "unmapped_trip", "route_mismatch", "realtime_only_trip"} else "unknown"
    direction = row.get("direction_id")
    service = {"routeId": identifier("route_id"), "tripId": identifier("trip_id") if mapping == "exact_trip" else None,
               "operator": operator, "directionId": direction if type(direction) is int and direction in {0, 1} else None,
               "mappingStatus": mapping, "linkage": "source_reported_unverified", "source": "get_live_vehicles"}
    return service


def parse_buses(value, now):
    if not isinstance(value, dict) or not isinstance(value.get("vehicles"), list) or len(value["vehicles"]) > 150:
        raise ValueError("invalid_bus_response")
    rows, ids = [], set()
    for row in value["vehicles"]:
        if not isinstance(row, dict) or not {"vehicle_key", "latitude", "longitude", "position_timestamp"}.issubset(row):
            raise ValueError("invalid_bus_record")
        point = coordinate(row.get("latitude"), row.get("longitude"))
        observed = stamp(row.get("position_timestamp"))
        key = text(row.get("vehicle_key"), 120)
        if not point or not observed or not key or key in ids or not -15 <= (now - observed).total_seconds() <= MAX_GPS_AGE:
            continue
        ids.add(key)
        rows.append({"id": "nta:" + key, "mode": "bus", "label": text(row.get("route_name")) or "Bus",
                     "destination": text(row.get("trip_headsign")), "lat": point[0], "lon": point[1],
                     "observedAt": iso(observed), "retrievedAt": iso(now), "quality": "gps_observation", "source": "nta",
                     "service": reported_bus_service(row)})
    return rows


def parse_trains(body, now):
    if len(body) > MAX_BODY:
        raise ValueError("rail_body_too_large")
    xml = body.decode("utf-8-sig", errors="strict")
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", xml, re.I):
        raise ValueError("rail_declarations_forbidden")
    root = ET.fromstring(xml)
    namespace = "{http://api.irishrail.ie/realtime/}"
    if root.tag != namespace + "ArrayOfObjTrainPositions" or len(root) > 400:
        raise ValueError("invalid_rail_response")
    if (root.text or "").strip() or (root.tail or "").strip():
        raise ValueError("invalid_rail_response")
    rows, ids = [], set()
    for item in root:
        if item.tag != namespace + "objTrainPositions" or len(item) > 20:
            raise ValueError("invalid_rail_record")
        if (item.text or "").strip() or (item.tail or "").strip():
            raise ValueError("invalid_rail_record")
        fields = {}
        for child in item:
            if len(child) or not child.tag.startswith(namespace) or child.tag in fields or (child.tail or "").strip():
                raise ValueError("invalid_rail_record")
            fields[child.tag] = child.text or ""
        get = lambda key: fields.get(namespace + key, "")
        if not {namespace + key for key in ("TrainStatus", "TrainLatitude", "TrainLongitude", "TrainCode")}.issubset(fields):
            raise ValueError("invalid_rail_record")
        code = get("TrainCode").strip()
        if get("TrainStatus").strip() != "R":
            continue
        # Service date rejects obsolete reports; it never becomes a GPS time.
        try:
            service_date = dt.datetime.strptime(get("TrainDate").strip(), "%d %b %Y").date()
        except ValueError:
            continue
        today = now.astimezone(ZoneInfo("Europe/Dublin")).date()
        if service_date not in {today, today - dt.timedelta(days=1)}:
            continue
        point = coordinate(get("TrainLatitude"), get("TrainLongitude"))
        if not point or not re.fullmatch(r"[A-Za-z0-9]{1,12}", code) or code in ids:
            continue
        ids.add(code)
        # TrainDate and retrieval time are NOT position-observation timestamps.
        rows.append({"id": "rail:" + code, "mode": "train", "label": "Train " + code,
                     "destination": text(get("Direction")), "lat": point[0], "lon": point[1],
                     "observedAt": None, "retrievedAt": iso(now), "quality": "reported_location", "source": "irish_rail"})
    return rows


def parse_departures(value, now):
    if not isinstance(value, dict) or not isinstance(value.get("departures"), list) or len(value["departures"]) > 60:
        raise ValueError("invalid_departures_response")
    rows, departure_ids = [], set()
    for row in value["departures"]:
        if not isinstance(row, dict):
            raise ValueError("invalid_departure_record")
        scheduled = stamp(row.get("scheduled_at"))
        if not scheduled:
            continue
        stop_id, trip_id = row.get("stop_id"), row.get("trip_id")
        if any(not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_ .:-]{1,120}", identifier) for identifier in (stop_id, trip_id)):
            raise ValueError("invalid_departure_identity")
        prediction = stamp(row.get("expected_at"))
        source_stamp = stamp(row.get("realtime_source_timestamp"))
        # SQL get_stop_departures_v2 uses GTFS CANCELED -> "canceled".
        # Accept the old gateway spelling only as a deliberate legacy alias.
        service_status = row.get("service_status", "scheduled")
        if not isinstance(service_status, str) or service_status not in {"scheduled", "canceled", "cancelled", "skipped", "no_data"}:
            raise ValueError("unknown_departure_service_status")
        cancelled = service_status in {"canceled", "cancelled"}
        skipped = service_status == "skipped"
        no_data = service_status == "no_data" or service_status == "scheduled" and row.get("data_status") == "scheduled_no_realtime"
        source_fresh = source_stamp is not None and -15 <= (now - source_stamp).total_seconds() <= MAX_GPS_AGE
        prediction_supported = row.get("data_status") in {"realtime_explicit", "realtime_derived", "realtime_propagated", "realtime_trip_delay"}
        fresh = service_status == "scheduled" and prediction_supported and source_fresh
        prediction_state = "none"
        if service_status == "scheduled" and prediction_supported and prediction:
            prediction_state = "fresh" if source_fresh else "expired" if source_stamp and (now - source_stamp).total_seconds() > MAX_GPS_AGE else "unconfirmed"
        departure_time = prediction if prediction and fresh else scheduled
        if departure_time < now - dt.timedelta(minutes=2):
            continue
        identity = "departure:" + hashlib.sha256(json.dumps([stop_id, trip_id, iso(scheduled)], separators=(",", ":")).encode()).hexdigest()
        if identity in departure_ids:
            raise ValueError("duplicate_departure_identity")
        departure_ids.add(identity)
        rows.append({"id": identity,
                     "stop": text(row.get("stop_name")), "route": text(row.get("route_name")),
                     "destination": text(row.get("trip_headsign")), "scheduledAt": iso(scheduled),
                     "expectedAt": iso(prediction) if prediction and fresh else None,
                     "predictionObservedAt": iso(source_stamp) if prediction and fresh else None,
                     "predictionState": prediction_state,
                     # This is a reported cancellation, not a current confirmation
                     # unless the browser can validate this observation's own age.
                     "cancellationObservedAt": iso(source_stamp) if cancelled and source_stamp else None,
                     "skippingObservedAt": iso(source_stamp) if skipped and source_stamp else None,
                     "stopId": stop_id, "tripId": trip_id,
                     "status": "cancelled" if cancelled else "skipped" if skipped else "no_data" if no_data else "predicted" if prediction and fresh else "scheduled"})
    return rows[:30]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("upstream_redirect_forbidden")


class SafeScheduleError(Exception):
    ALLOWED = {400: {"unknown_stop", "date_outside_feed", "invalid_search"},
               429: {"rate_limited"},
               503: {"clock_change_unsupported", "search_capacity_reached", "schedules_unavailable"}}

    def __init__(self, status, code, retry_after=None):
        if type(status) is not int or code not in self.ALLOWED.get(status, set()):
            raise ValueError("invalid_safe_schedule_error")
        self.status, self.code = status, code
        self.retry_after = max(1, min(60, retry_after)) if type(retry_after) is int else (60 if status == 429 else None)
        super().__init__(code)


def fetch_source(name, public_key, params=None):
    if name not in {"health", "vehicles", "departures", "rail", "stops", "journeys", "admission"}:
        raise ValueError("unknown_source")
    if name == "admission" and params is not None:
        raise ValueError("invalid_admission_parameters")
    schedule = name in {"stops", "journeys", "admission"}
    headers = {"User-Agent": "BallinaMove/0.1 official-source reader"}
    query = {"action": name, **(params or {})} if schedule else {"action": name, "max_age": 180, "limit": 60}
    url = RAIL_URL if name == "rail" else (JOURNEY_URL if schedule else TRANSPORT_URL) + "?" + urllib.parse.urlencode(query)
    if name != "rail":
        headers["apikey"] = public_key
    if schedule:
        credential = os.environ.get("BALLINA_JOURNEY_GATEWAY_SECRET", "")
        if not re.fullmatch(r"[a-f0-9]{64}", credential):
            raise ValueError("journey_gateway_configuration_missing")
        # Dedicated server-only authorization, never transport/rail/browser.
        headers["X-Ballina-Gateway"] = credential
    opener = urllib.request.build_opener(NoRedirect())
    budget = 3 if name == "admission" else 20 if schedule else 8
    maximum = 1024 if name == "admission" else MAX_BODY
    deadline = time.monotonic() + budget
    failed_status = None
    try:
        response = opener.open(urllib.request.Request(url, headers=headers), timeout=budget)
    except urllib.error.HTTPError as exc:
        if name in {"stops", "journeys"} and exc.code == 429:
            retry = exc.headers.get("Retry-After", "")
            exc.close()  # No upstream error body or private diagnostics needed.
            raise SafeScheduleError(429, "rate_limited", int(retry) if re.fullmatch(r"[1-9]\d{0,2}", retry) else 60) from None
        if name in {"stops", "journeys"} and exc.code in {400, 503}:
            failed_status = exc.code
        elif name != "health" or exc.code != 503:
            exc.close()
            raise ValueError("upstream_unavailable") from None
        response = exc
    with response:
        if int(response.headers.get("Content-Length", "0")) > maximum:
            raise ValueError("upstream_body_too_large")
        body = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("upstream_timeout")
            # urllib owns the proxy/TLS connection. Shorten its next read to
            # the remaining absolute budget, preserving that verified route.
            socket = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
            if socket is not None:
                socket.settimeout(remaining)
            chunk = response.read1(min(16384, maximum + 1 - len(body)))
            if time.monotonic() >= deadline:
                raise ValueError("upstream_timeout")
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > maximum:
                raise ValueError("upstream_body_too_large")
    if failed_status is not None:
        try:
            data = json.loads(body.decode("utf-8", errors="strict"))
            code = data.get("error") if isinstance(data, dict) else None
        except (ValueError, UnicodeError):
            code = None
        if isinstance(code, str) and code in SafeScheduleError.ALLOWED[failed_status]:
            raise SafeScheduleError(failed_status, code)
        raise SafeScheduleError(503, "schedules_unavailable")
    return bytes(body) if name == "rail" else json.loads(body.decode("utf-8", errors="strict"))


def public_key():
    key = os.environ.get("BALLINA_TRANSPORT_API_KEY")
    if not key:
        # Reuse the already-public key from the repository; never request or
        # load a privileged/service-role key for this read-only gateway.
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows/post-activation-health.yml"
        match = re.search(r"SUPABASE_PUBLISHABLE_KEY:\s*(\S+)", workflow.read_text())
        key = match.group(1) if match else ""
    if not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{12,160}", key):
        raise ValueError("public_transport_key_unavailable")
    return key


def admission_check(fetcher=fetch_source):
    """One private protocol probe; caller supplies process-level DNS watchdog."""
    if not re.fullmatch(r"[a-f0-9]{64}", os.environ.get("BALLINA_JOURNEY_GATEWAY_SECRET", "")):
        return {"check": "schedule_admission", "confirmed": False, "error": "configuration_missing", "requestsMaximum": 0}
    try:
        value = fetcher("admission", public_key())
        expected = {"version": 1, "source": "journey-api", "admission": "gateway-secret-v1", "quotaConsumed": False, "snapshotRead": False}
        if not isinstance(value, dict) or value.keys() != expected.keys() or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items()):
            raise ValueError("unproven_admission")
        return {"check": "schedule_admission", "confirmed": True, "requestsMaximum": 1,
                "scope": "private credential agreement only; not GTFS, peer identity or host performance", "quotaConsumed": False, "snapshotRead": False}
    except Exception:
        return {"check": "schedule_admission", "confirmed": False, "error": "admission_unavailable", "requestsMaximum": 1}


def checked_admission_process(runner=subprocess.run):
    # Never pass management/import/provider secrets to this one-purpose child.
    allowed = {"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
               "https_proxy", "http_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR",
               "BALLINA_JOURNEY_GATEWAY_SECRET", "BALLINA_TRANSPORT_API_KEY"}
    env = {k: v for k, v in os.environ.items() if k in allowed}
    try:
        result = runner([sys.executable, str(Path(__file__).resolve()), "--admission-worker"], env=env, capture_output=True, text=True, timeout=5)
        value = json.loads(result.stdout)
        # Child output is our diagnostic only, not raw upstream data/errors.
        if not isinstance(value, dict) or result.returncode not in {0, 1} or type(value.get("confirmed")) is not bool or value.get("check") != "schedule_admission" or result.returncode != (0 if value["confirmed"] else 1):
            raise ValueError("invalid_probe_output")
        if value["confirmed"]:
            expected = {"check": "schedule_admission", "confirmed": True, "requestsMaximum": 1,
                        "scope": "private credential agreement only; not GTFS, peer identity or host performance", "quotaConsumed": False, "snapshotRead": False}
            if value.keys() != expected.keys() or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items()):
                raise ValueError("invalid_probe_output")
            return expected
        error = value.get("error")
        if error not in {"configuration_missing", "admission_unavailable"}:
            raise ValueError("invalid_probe_output")
        expected = {"check": "schedule_admission", "confirmed": False, "error": error, "requestsMaximum": 0 if error == "configuration_missing" else 1}
        if value.keys() != expected.keys() or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items()):
            raise ValueError("invalid_probe_output")
        return expected
    except Exception:
        return {"check": "schedule_admission", "confirmed": False, "error": "probe_failed_or_timed_out", "requestsMaximum": 1}


def schedule_query(query, now=None):
    if len(query) > 700:
        raise ValueError("invalid_search")
    params = urllib.parse.parse_qs(query, keep_blank_values=True, max_num_fields=6)
    keys = {"from", "to", "date", "time", "modes", "changes"}
    if params.keys() != keys or any(len(v) != 1 for v in params.values()):
        raise ValueError("invalid_search")
    q = {k: v[0] for k, v in params.items()}
    today = (now or dt.datetime.now(UTC)).astimezone(ZoneInfo("Europe/Dublin")).date()
    try:
        date = dt.date.fromisoformat(q["date"])
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", q["date"]) or not 0 <= (date - today).days <= 14:
            raise ValueError("invalid_search")
    except ValueError:
        raise ValueError("invalid_search") from None
    if not all(re.fullmatch(r"[A-Za-z0-9_ .:-]{1,120}", q[k]) for k in ["from", "to"]) or q["from"] == q["to"] or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", q["time"]) or q["modes"] not in {"bus", "rail", "bus,rail"} or q["changes"] not in {"0", "1", "2"}:
        raise ValueError("invalid_search")
    return q


def public_stop(row):
    if not isinstance(row, dict):
        raise ValueError("invalid_stop")
    point = coordinate(row.get("lat"), row.get("lon"))
    identifier = row.get("id")
    if not point or not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_ .:-]{1,120}", identifier) or not isinstance(row.get("name"), str) or not row["name"]:
        raise ValueError("invalid_stop")
    return {"id": identifier, "name": text(row["name"]), "code": text(row.get("code"), 50) or None, "lat": point[0], "lon": point[1]}


def public_schedule(value, params=None):
    if not isinstance(value, dict) or type(value.get("version")) is not int or value.get("version") not in {1, 2} or value.get("source") != "nta_gtfs" or value.get("timezone") != "Europe/Dublin" or value.get("scope") != "stop_to_stop_same_stop_transfers" or not stamp(value.get("loadedAt")) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", str(value.get("feedVersion", ""))):
        raise ValueError("invalid_schedule")
    base = {k: value[k] for k in ["version", "source", "timezone", "scope", "loadedAt", "feedVersion"]}
    if params is None:
        if value["version"] != 1:
            raise ValueError("invalid_catalog_version")
        stops = value.get("stops")
        if not isinstance(stops, list) or not 1 <= len(stops) <= 1000:
            raise ValueError("invalid_stops")
        cleaned = [public_stop(s) for s in stops]
        if len({s["id"] for s in cleaned}) != len(cleaned):
            raise ValueError("duplicate_stop")
        for k in ["validFrom", "validUntil"]:
            if not isinstance(value.get(k), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value[k]):
                raise ValueError("invalid_feed_dates")
            dt.date.fromisoformat(value[k])
        return {**base, "validFrom": value["validFrom"], "validUntil": value["validUntil"], "stops": cleaned}
    if value.get("serviceDate") != params["date"] or value.get("walkingIncluded") is not False or value.get("realTimeApplied") is not False or value.get("predictionType") != "scheduled" or value.get("minBoardingSeconds") != 60 or value.get("minTransferSeconds") != 120:
        raise ValueError("invalid_journey_provenance")
    journeys = value.get("journeys")
    if not isinstance(journeys, list) or len(journeys) > 6:
        raise ValueError("invalid_journeys")
    cleaned, journey_ids = [], set()
    depart = int(params["time"][:2]) * 3600 + int(params["time"][3:]) * 60
    if value["version"] == 2:
        zone = ZoneInfo("Europe/Dublin")
        midnight = dt.datetime.fromisoformat(params["date"] + "T00:00").replace(tzinfo=zone).astimezone(UTC)
        if stamp(value.get("referenceAt")) != midnight:
            raise ValueError("invalid_schedule_reference")
        civil = dt.datetime.fromisoformat(params["date"] + "T" + params["time"])
        candidates = {civil.replace(tzinfo=zone, fold=fold).astimezone(UTC) for fold in [0, 1]
                      if civil.replace(tzinfo=zone, fold=fold).astimezone(UTC).astimezone(zone).replace(tzinfo=None) == civil}
        if len(candidates) != 1:
            raise ValueError("ambiguous_schedule_query")
        depart = int((candidates.pop() - midnight).total_seconds())
        base["referenceAt"] = iso(midnight)
    elif "referenceAt" in value:
        raise ValueError("invalid_legacy_schedule_reference")
    for j in journeys:
        if not isinstance(j, dict) or not isinstance(j.get("rides"), list) or not 1 <= len(j["rides"]) <= int(params["changes"]) + 1:
            raise ValueError("invalid_journey")
        identity = j.get("id")
        if not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_ .:-]{1,120}", identity) or identity in journey_ids:
            raise ValueError("invalid_journey_identity")
        journey_ids.add(identity)
        rides, trip_keys = [], set()
        for r in j["rides"]:
            if not isinstance(r, dict) or r.get("mode") not in params["modes"].split(",") or not isinstance(r.get("tripId"), str) or not r["tripId"] or len(r["tripId"]) > 120:
                raise ValueError("invalid_ride")
            board, alight = r.get("boardAt"), r.get("alightAt")
            if any(type(t) is not int for t in [board, alight]) or not depart + 60 <= board <= alight <= depart + 36 * 3600:
                raise ValueError("invalid_ride_time")
            start, end = public_stop(r.get("from")), public_stop(r.get("to"))
            if (rides and (start["id"] != rides[-1]["to"]["id"] or board < rides[-1]["alightAt"] + 120)) or (not rides and start["id"] != params["from"]):
                raise ValueError("invalid_connection")
            date = r.get("serviceDate")
            if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or not (-3 if value["version"] == 2 else -2) <= (dt.date.fromisoformat(date) - dt.date.fromisoformat(params["date"])).days <= 2 or (date, r["tripId"]) in trip_keys:
                raise ValueError("invalid_service_day")
            trip_keys.add((date, r["tripId"]))
            operational = {}
            if any(k in r for k in ["routeId", "boardSequence", "alightSequence"]):
                route_id, board_seq, alight_seq = r.get("routeId"), r.get("boardSequence"), r.get("alightSequence")
                if not isinstance(route_id, str) or not re.fullmatch(r"[A-Za-z0-9_ .:-]{1,120}", route_id) or type(board_seq) is not int or type(alight_seq) is not int or not 0 <= board_seq < alight_seq:
                    raise ValueError("invalid_operational_sequence")
                operational = {"routeId": route_id, "boardSequence": board_seq, "alightSequence": alight_seq}
            rides.append({"tripId": text(r["tripId"], 120), "route": text(r.get("route")), "mode": r["mode"], "destination": text(r.get("destination")), "from": start, "to": end, "boardAt": board, "alightAt": alight, "serviceDate": date, **operational})
        if rides[-1]["to"]["id"] != params["to"] or j.get("departureAt") != rides[0]["boardAt"] or j.get("arrivalAt") != rides[-1]["alightAt"] or j.get("changes") != len(rides) - 1:
            raise ValueError("invalid_journey_summary")
        cleaned.append({"id": identity, "departureAt": rides[0]["boardAt"], "arrivalAt": rides[-1]["alightAt"], "changes": len(rides) - 1, "rides": rides})
    return {**base, "serviceDate": params["date"], "predictionType": "scheduled", "walkingIncluded": False, "realTimeApplied": False, "minBoardingSeconds": 60, "minTransferSeconds": 120, "journeys": cleaned}


class ScheduleService:
    def __init__(self, loader=fetch_source, key=None):
        self.loader, self.key = loader, key or public_key()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        self.lock = threading.Lock()
        self.futures = set()
        self.client_work = {}
        self.catalog_cache = None
        self.catalog_at = 0
        self.catalog_work = None
        self.catalog_ready = False

    def get(self, params=None, client=None):
        with self.lock:
            if params is None and self.catalog_cache is not None and time.monotonic() - self.catalog_at < 45:
                return self.catalog_cache
            self.futures = {f for f in self.futures if not f.done()}
            self.client_work = {k: f for k, f in self.client_work.items() if not f.done()}
            if params is not None and client is not None and client in self.client_work:
                raise ValueError("schedule_client_busy")
            if params is None and self.catalog_work is not None and not self.catalog_ready:
                future = self.catalog_work  # Bounded callers share the cold read.
            else:
                if len(self.futures) >= 2:
                    raise ValueError("schedule_capacity")
                future = self.pool.submit(self.loader, "stops" if params is None else "journeys", self.key, params)
                self.futures.add(future)
                if params is None:
                    self.catalog_work = future
                    self.catalog_ready = False
                elif client is not None:
                    self.client_work[client] = future
        try:
            value = public_schedule(future.result(timeout=21), params)
        except Exception:
            if params is None and future.done():
                with self.lock:
                    if self.catalog_work is future:
                        self.catalog_work = None
            raise
        if params is None:
            with self.lock:
                # Only the first publisher of the current flight can install
                # its result. A delayed waiter must not renew its TTL or
                # overwrite a newer feed generation after a refresh.
                if self.catalog_work is future and not self.catalog_ready:
                    self.catalog_cache, self.catalog_at = value, time.monotonic()
                    self.catalog_ready = True
        return value


class LiveService:
    def __init__(self, fetcher=fetch_source, key=None, now=None, refresh_timeout=9):
        self.fetcher, self.key = fetcher, key if key is not None else public_key()
        self.now = now or (lambda: dt.datetime.now(UTC))
        self.condition = threading.Condition()
        self.cached, self.expires, self.pending = None, 0, False
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        self.work = {}
        self.refresh_timeout = refresh_timeout

    def get(self):
        with self.condition:
            deadline = time.monotonic() + 12
            while self.pending:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError("gateway_busy")
                self.condition.wait(remaining)
            if self.cached is not None and time.monotonic() < self.expires:
                return self.cached
            self.pending = True
        try:
            raw, failures = {}, set()
            # A fixed pool bounds DNS/socket hangs too. Never queue another
            # refresh behind unfinished upstream work or wait on pool shutdown.
            names = ("health", "vehicles", "departures", "rail")
            if any(not f.done() for f in self.work.values()):
                failures.update(names)
            else:
                self.work = {name: self.pool.submit(self.fetcher, name, self.key) for name in names}
                done, _ = concurrent.futures.wait(self.work.values(), timeout=self.refresh_timeout)
                for name, future in self.work.items():
                    if future not in done:
                        failures.add(name)
                        continue
                    try:
                        raw[name] = future.result()
                    except Exception:
                        failures.add(name)
            now = self.now()
            health = raw.get("health", {})
            collector = health.get("collector") if isinstance(health, dict) else None
            healthy = isinstance(health, dict) and health.get("status") == "ok" and isinstance(collector, dict) and collector.get("healthy") is True
            sources, vehicles, departures = {}, [], []
            for name, parser in (("bus", parse_buses), ("rail", parse_trains), ("departures", parse_departures)):
                source_name = "vehicles" if name == "bus" else name
                try:
                    if source_name in failures or name != "rail" and not healthy:
                        raise ValueError("source_unavailable")
                    rows = parser(raw[source_name], now)
                    sources[name] = {"status": "ready" if rows else "empty", "retrievedAt": iso(now)}
                    if name == "departures":
                        departures = rows
                    else:
                        vehicles.extend(rows)
                except Exception:
                    sources[name] = {"status": "unavailable", "retrievedAt": None}
            value = {"version": 2, "mode": "live", "generatedAt": iso(now), "gpsMaxAgeSeconds": MAX_GPS_AGE,
                     "collectorHealthy": healthy, "sources": sources, "vehicles": vehicles, "departures": departures}
            with self.condition:
                self.cached = value
                self.expires = time.monotonic() + (20 if any(s["status"] != "unavailable" for s in sources.values()) else 5)
            return value
        finally:
            with self.condition:
                self.pending = False
                self.condition.notify_all()


class PeerBudget:
    """Short-lived network-peer shaping, not authenticated passenger identity.

    Ignores all forwarded headers/cookies. Behind a proxy peers can be shared;
    deployment must validate that boundary. No IPs/logs/persistent identifiers.
    """
    LIMITS = {"/api/journeys": 6, "/api/stops": 10, "/api/live": 8}

    def __init__(self, clock=time.monotonic, maximum=512):
        self.clock, self.maximum = clock, maximum
        self.salt = secrets.token_bytes(32)
        self.lock, self.buckets = threading.Lock(), {}

    def identity(self, address):
        ip = ipaddress.ip_address(address)
        if ip.version == 6 and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        network = ipaddress.ip_network(f"{ip}/64", strict=False) if ip.version == 6 else ip
        return hmac.new(self.salt, str(network).encode("ascii"), hashlib.sha256).hexdigest()

    def allow(self, identity, path):
        if path not in self.LIMITS:
            return False
        with self.lock:
            now = self.clock()
            expired = []
            for key, times in self.buckets.items():
                while times and now - times[0] >= 60:
                    times.popleft()
                if not times:
                    expired.append(key)
            for key in expired:
                del self.buckets[key]
            key = (identity, path)
            times = self.buckets.get(key)
            if times is None:
                if len(self.buckets) >= self.maximum:
                    return False  # Never evict live budgets to reset a caller.
                times = self.buckets[key] = deque()
            if len(times) >= self.LIMITS[path]:
                return False
            times.append(now)
            return True


class GatewayHandler(http.server.BaseHTTPRequestHandler):
    service: LiveService
    rate_lock = threading.Lock()
    request_times = []

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *args):
        pass  # No client locations, headers, keys or URLs in logs.

    def respond(self, body, status=200, content_type="application/json; charset=utf-8", standalone=False, retry_after=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-store")
        if type(retry_after) is int:
            self.send_header("Retry-After", str(max(1, min(60, retry_after))))
        if not standalone:
            self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_POST(self):
        self.respond(b'{"error":"method_not_allowed"}', 405)
        self.close_connection = True

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path)
        if path in {"/api/live", "/api/stops", "/api/journeys"}:
            if (url.query and path != "/api/journeys") or self.command != "GET":
                self.respond(b'{"error":"invalid_request"}', 400)
                return
            try:
                params = schedule_query(url.query) if path == "/api/journeys" else None
            except ValueError:
                self.respond(b'{"error":"invalid_search"}', 400)
                return
            # Only the actual TCP peer defines this soft budget. Client-supplied
            # IP, cookie, authorization and forwarding headers cannot rotate it.
            client = self.server.client_budget.identity(self.client_address[0])
            with self.rate_lock:
                now = time.monotonic()
                self.request_times[:] = [t for t in self.request_times if now - t < 60]
                admitted = len(self.request_times) < 60 and self.server.client_budget.allow(client, path)
                if admitted:
                    self.request_times.append(now)
            if not admitted:
                # Socket writes never hold the shared accounting lock.
                self.respond(b'{"error":"rate_limited"}', 429, retry_after=60)
                return
            try:
                value = self.service.get() if path == "/api/live" else self.schedules.get(params, client=client)
                self.respond(json.dumps(value, ensure_ascii=False).encode("utf-8"))
            except SafeScheduleError as error:
                self.respond(json.dumps({"error": error.code}).encode("utf-8"), error.status, retry_after=error.retry_after)
            except Exception:
                self.respond(b'{"error":"live_service_unavailable"}' if path == "/api/live" else b'{"error":"schedules_unavailable"}', 503)
            return
        if path not in {"/", "/index.html", "/ballina-move.html", "/favicon.svg"} and not path.startswith("/assets/"):
            self.respond(b'{"error":"not_found"}', 404)
            return
        root = ROOT.resolve()
        file = (root / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            self.respond(b'{"error":"not_found"}', 404)
            return
        self.respond(file.read_bytes(), content_type=mimetypes.guess_type(file)[0] or "application/octet-stream", standalone=path == "/ballina-move.html")


class GatewayServer(http.server.ThreadingHTTPServer):
    def __init__(self, *args, **kwargs):
        self.client_budget = PeerBudget()
        super().__init__(*args, **kwargs)

    def handle_error(self, request, client_address):
        # Base socketserver handler otherwise prints client address/traceback.
        print('{"event":"gateway_request_failed"}', file=sys.stderr)

    daemon_threads = True
    slots = threading.BoundedSemaphore(16)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--snapshot", type=Path)
    mode.add_argument("--check-admission", action="store_true")
    mode.add_argument("--admission-worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.check_admission or args.admission_worker:
        value = admission_check() if args.admission_worker else checked_admission_process()
        print(json.dumps(value))
        return 0 if value["confirmed"] else 1
    service = LiveService()
    if args.snapshot:
        value = service.get()
        if all(source["status"] == "unavailable" for source in value["sources"].values()):
            raise ValueError("no_verified_source_for_snapshot")
        value["mode"] = "snapshot"
        args.snapshot.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        print("Public snapshot exported; no credentials or backend internals.")
        return
    port = int(os.environ.get("BALLINA_PREVIEW_PORT", "5173"))
    if not 1024 <= port <= 65535 or not ROOT.is_dir():
        raise ValueError("invalid_live_preview_configuration")
    GatewayHandler.service = service
    GatewayHandler.schedules = ScheduleService()
    server = GatewayServer(("0.0.0.0", port), GatewayHandler)
    print(f"Ballina read-only live app on internal port {port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
