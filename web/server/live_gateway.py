"""Read-only same-origin transport gateway. Never serves checkout or credentials."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import http.server
import json
import math
import mimetypes
import os
from pathlib import Path
import re
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
                     "observedAt": iso(observed), "retrievedAt": iso(now), "quality": "gps_observation", "source": "nta"})
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
    rows = []
    for row in value["departures"]:
        if not isinstance(row, dict):
            raise ValueError("invalid_departure_record")
        scheduled = stamp(row.get("scheduled_at"))
        if not scheduled:
            continue
        prediction = stamp(row.get("expected_at"))
        source_stamp = stamp(row.get("realtime_source_timestamp"))
        cancelled = row.get("service_status") == "cancelled"
        fresh = not cancelled and source_stamp is not None and -15 <= (now - source_stamp).total_seconds() <= MAX_GPS_AGE
        departure_time = prediction if prediction and fresh else scheduled
        if departure_time < now - dt.timedelta(minutes=2):
            continue
        rows.append({"id": text(row.get("stop_id"), 100) + ":" + text(row.get("trip_id"), 120) + ":" + iso(scheduled),
                     "stop": text(row.get("stop_name")), "route": text(row.get("route_name")),
                     "destination": text(row.get("trip_headsign")), "scheduledAt": iso(scheduled),
                     "expectedAt": iso(prediction) if prediction and fresh else None,
                     "predictionObservedAt": iso(source_stamp) if prediction and fresh else None,
                     "status": "cancelled" if cancelled else "predicted" if prediction and fresh else "scheduled"})
    return rows[:30]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("upstream_redirect_forbidden")


def fetch_source(name, public_key):
    if name not in {"health", "vehicles", "departures", "rail"}:
        raise ValueError("unknown_source")
    headers = {"User-Agent": "BallinaMove/0.1 official-source reader"}
    url = RAIL_URL if name == "rail" else TRANSPORT_URL + "?" + urllib.parse.urlencode({"action": name, "max_age": 180, "limit": 60})
    if name != "rail":
        headers["apikey"] = public_key
    opener = urllib.request.build_opener(NoRedirect())
    deadline = time.monotonic() + 8
    try:
        response = opener.open(urllib.request.Request(url, headers=headers), timeout=8)
    except urllib.error.HTTPError as exc:
        if name != "health" or exc.code != 503:
            raise ValueError("upstream_unavailable") from None
        response = exc
    with response:
        if int(response.headers.get("Content-Length", "0")) > MAX_BODY:
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
            chunk = response.read1(min(16384, MAX_BODY + 1 - len(body)))
            if time.monotonic() >= deadline:
                raise ValueError("upstream_timeout")
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > MAX_BODY:
                raise ValueError("upstream_body_too_large")
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
            value = {"version": 1, "mode": "live", "generatedAt": iso(now), "gpsMaxAgeSeconds": MAX_GPS_AGE,
                     "collectorHealthy": healthy, "sources": sources, "vehicles": vehicles, "departures": departures}
            with self.condition:
                self.cached = value
                self.expires = time.monotonic() + (20 if any(s["status"] != "unavailable" for s in sources.values()) else 5)
            return value
        finally:
            with self.condition:
                self.pending = False
                self.condition.notify_all()


class GatewayHandler(http.server.BaseHTTPRequestHandler):
    service: LiveService
    rate_lock = threading.Lock()
    request_times = []

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *args):
        pass  # No client locations, headers, keys or URLs in logs.

    def respond(self, body, status=200, content_type="application/json; charset=utf-8", standalone=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-store")
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
        if path == "/api/live":
            if url.query or self.command != "GET":
                self.respond(b'{"error":"invalid_request"}', 400)
                return
            with self.rate_lock:
                now = time.monotonic()
                self.request_times[:] = [t for t in self.request_times if now - t < 60]
                if len(self.request_times) >= 60:
                    self.respond(b'{"error":"rate_limited"}', 429)
                    return
                self.request_times.append(now)
            try:
                value = self.service.get()
                self.respond(json.dumps(value, ensure_ascii=False).encode("utf-8"))
            except Exception:
                self.respond(b'{"error":"live_service_unavailable"}', 503)
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
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args()
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
    server = GatewayServer(("0.0.0.0", port), GatewayHandler)
    print(f"Ballina read-only live app on internal port {port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
