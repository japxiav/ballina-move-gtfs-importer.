import concurrent.futures
import datetime as dt
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("live_gateway", Path(__file__).parents[1] / "live_gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
NOW = dt.datetime(2026, 10, 12, 20, 0, tzinfo=dt.timezone.utc)


def bus(**extra):
    return {"vehicle_key": "offline-fixture-bus", "route_name": "420", "trip_headsign": "Ballina", "latitude": 54.11,
            "longitude": -9.15, "position_timestamp": "2026-10-12T19:59:30Z", **extra}


def rail(lat="54.11", lon="-9.15", status="R", code="P001"):
    return f'<ArrayOfObjTrainPositions xmlns="http://api.irishrail.ie/realtime/"><objTrainPositions><TrainStatus>{status}</TrainStatus><TrainLatitude>{lat}</TrainLatitude><TrainLongitude>{lon}</TrainLongitude><TrainCode>{code}</TrainCode><TrainDate>12 Oct 2026</TrainDate></objTrainPositions></ArrayOfObjTrainPositions>'.encode()


def source(name, key):
    return {"health": {"status": "ok", "collector": {"healthy": True}, "private_metadata": "never-forward"},
            "vehicles": {"vehicles": [bus()], "apikey": "never-forward"}, "departures": {"departures": []}, "rail": rail()}[name]


class LiveContract(unittest.TestCase):
    def test_real_position_timestamp_is_not_ingestion_or_generation_time(self):
        rows = gateway.parse_buses({"generated_at": "2026-10-12T20:00:00Z", "vehicles": [bus(observed_at="2026-10-12T20:00:00Z", age_seconds=0)]}, NOW)
        self.assertEqual(rows[0]["observedAt"], "2026-10-12T19:59:30Z")
        self.assertNotIn("observed_at", rows[0])

    def test_old_missing_and_future_gps_never_create_live_markers(self):
        for timestamp in [None, "2026-10-12T19:50:00Z", "2026-10-12T20:05:00Z", "bad", "2026-10-12T20:00:00"]:
            with self.subTest(timestamp=timestamp):
                self.assertEqual(gateway.parse_buses({"vehicles": [bus(position_timestamp=timestamp)]}, NOW), [])

    def test_invalid_coordinates_never_create_markers(self):
        for lat, lon in [(0, 0), (float("nan"), -9), (54, float("inf")), (91, -9), (54, True), (54, -1)]:
            with self.subTest(point=(lat, lon)):
                self.assertEqual(gateway.parse_buses({"vehicles": [bus(latitude=lat, longitude=lon)]}, NOW), [])

    def test_duplicate_vehicle_id_cannot_generate_conflicting_markers(self):
        self.assertEqual(len(gateway.parse_buses({"vehicles": [bus(), bus(latitude=54.2)]}, NOW)), 1)

    def test_changed_bus_schema_is_an_error_not_an_empty_valid_feed(self):
        for value in [{}, {"vehicles": {}}, {"vehicles": [{}]}, {"vehicles": [bus()] * 151}]:
            with self.subTest(value=type(value)):
                with self.assertRaises(ValueError):
                    gateway.parse_buses(value, NOW)

    def test_train_observation_time_is_explicitly_unknown(self):
        row = gateway.parse_trains(rail(), NOW)[0]
        self.assertIsNone(row["observedAt"])
        self.assertEqual(row["quality"], "reported_location")
        self.assertEqual(row["retrievedAt"], gateway.iso(NOW))
        self.assertNotIn("tripId", row)
        self.assertNotIn("TrainDate", row)

    def test_train_service_date_rejects_obsolete_reports_without_becoming_observation_age(self):
        for date in [b"01 Jan 2020", b"13 Oct 2026", b"invalid", b""]:
            self.assertEqual(gateway.parse_trains(rail().replace(b"12 Oct 2026", date), NOW), [])
        self.assertEqual(len(gateway.parse_trains(rail(code=" P001 "), NOW)), 1)
        row = gateway.parse_trains(rail().replace(b"12 Oct 2026", b"11 Oct 2026"), NOW)[0]
        self.assertIsNone(row["observedAt"])

    def test_nonrunning_and_invalid_trains_are_not_drawn(self):
        for value in [rail(status="N"), rail(status="T"), rail(lat="0", lon="0"), rail(lat="NaN"), rail(code="<bad/>")]:
            with self.subTest(value=value[:50]):
                try:
                    result = gateway.parse_trains(value, NOW)
                except (ValueError, gateway.ET.ParseError):
                    result = []
                self.assertEqual(result, [])

    def test_xml_declarations_namespace_truncation_and_duplicate_fields_fail_closed(self):
        for value in [b'<!DOCTYPE x [<!ENTITY a "expanded">]>' + rail(), rail().replace(b"realtime/", b"untrusted/"), rail()[:-10],
                      rail().replace(b"</TrainCode>", b"</TrainCode><TrainCode>P002</TrainCode>"), rail().replace(b"<TrainLatitude>54.11</TrainLatitude>", b"")]:
            with self.subTest(value=value[:50]):
                with self.assertRaises((ValueError, gateway.ET.ParseError)):
                    gateway.parse_trains(value, NOW)

    def test_response_size_is_bounded_before_xml_parsing(self):
        with self.assertRaises(ValueError):
            gateway.parse_trains(b"x" * (gateway.MAX_BODY + 1), NOW)

    def test_departure_prediction_requires_its_own_fresh_source_timestamp(self):
        row = {"scheduled_at": "2026-10-12T20:10:00Z", "expected_at": "2026-10-12T20:12:00Z", "realtime_source_timestamp": "2026-10-12T19:59:00Z"}
        actual = gateway.parse_departures({"departures": [row]}, NOW)[0]
        self.assertEqual(actual["status"], "predicted")
        row["realtime_source_timestamp"] = "2026-10-12T19:40:00Z"
        stale = gateway.parse_departures({"departures": [row]}, NOW)[0]
        self.assertEqual(stale["status"], "scheduled")
        self.assertIsNone(stale["expectedAt"])

    def test_cancelled_departure_never_becomes_a_live_prediction(self):
        row = {"scheduled_at": "2026-10-12T20:10:00Z", "expected_at": "2026-10-12T20:12:00Z", "realtime_source_timestamp": "2026-10-12T19:59:00Z", "service_status": "cancelled"}
        result = gateway.parse_departures({"departures": [row]}, NOW)[0]
        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["expectedAt"])
        self.assertIsNone(result["predictionObservedAt"])

    def test_delayed_future_prediction_survives_old_schedule_only_while_fresh(self):
        row = {"scheduled_at": "2026-10-12T19:50:00Z", "expected_at": "2026-10-12T20:05:00Z", "realtime_source_timestamp": "2026-10-12T19:59:40Z"}
        self.assertEqual(gateway.parse_departures({"departures": [row]}, NOW)[0]["status"], "predicted")
        row["realtime_source_timestamp"] = "2026-10-12T19:50:00Z"
        self.assertEqual(gateway.parse_departures({"departures": [row]}, NOW), [])
        row["realtime_source_timestamp"] = "2026-10-12T19:59:40Z"
        row["expected_at"] = "2026-10-12T19:50:00Z"
        self.assertEqual(gateway.parse_departures({"departures": [row]}, NOW), [])

    def test_unhealthy_collector_disables_bus_and_departure_feed(self):
        def unhealthy(name, key):
            return {"status": "degraded", "collector": {"healthy": False}} if name == "health" else source(name, key)
        value = gateway.LiveService(unhealthy, key="offline-fixture", now=lambda: NOW).get()
        self.assertEqual(value["sources"]["bus"]["status"], "unavailable")
        self.assertEqual([v["mode"] for v in value["vehicles"]], ["train"])

    def test_failures_are_sanitized_without_fabricated_vehicles(self):
        def fail(name, key):
            raise RuntimeError("secret-private-upstream-url")
        value = gateway.LiveService(fail, key="offline-fixture", now=lambda: NOW).get()
        self.assertEqual(value["vehicles"], [])
        self.assertTrue(all(s["status"] == "unavailable" for s in value["sources"].values()))
        self.assertNotIn("secret-private", json.dumps(value))

    def test_response_whitelist_excludes_keys_trip_identifiers_and_backend_metadata(self):
        value = gateway.LiveService(source, key="offline-fixture", now=lambda: NOW).get()
        raw = json.dumps(value)
        for forbidden in ["apikey", "private_metadata", "never-forward", "position_timestamp", "trip_id"]:
            self.assertNotIn(forbidden, raw)

    def test_concurrent_clients_share_one_bounded_refresh_and_cache(self):
        lock = threading.Lock()
        calls = []
        def slow(name, key):
            with lock:
                calls.append(name)
            time.sleep(.02)
            return source(name, key)
        service = gateway.LiveService(slow, key="offline-fixture", now=lambda: NOW)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: service.get(), range(8)))
        self.assertEqual(sorted(calls), ["departures", "health", "rail", "vehicles"])
        self.assertTrue(all(v == results[0] for v in results))
        service.get()
        self.assertEqual(len(calls), 4)

    def test_redirects_are_never_followed(self):
        with self.assertRaises(ValueError):
            gateway.NoRedirect().redirect_request(None, None, 302, "found", {}, "http://private.invalid")

    def test_stuck_upstream_has_global_deadline_without_new_threads_or_queued_refreshes(self):
        release = threading.Event()
        calls = []
        def stuck(name, key):
            calls.append(name)
            release.wait(3)
            return source(name, key)
        service = gateway.LiveService(stuck, key="offline-fixture", now=lambda: NOW, refresh_timeout=.05)
        try:
            start = time.monotonic()
            value = service.get()
            self.assertLess(time.monotonic() - start, .5)
            self.assertEqual(value["vehicles"], [])
            for _ in range(3):
                service.expires = 0
                self.assertEqual(service.get()["vehicles"], [])
            self.assertEqual(sorted(calls), ["departures", "health", "rail", "vehicles"])
            self.assertEqual(len(service.work), 4)
        finally:
            release.set()
            service.pool.shutdown(wait=True)


class HttpBoundary(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "index.html").write_text("Ballina fixture-test build")
        (self.root / "assets").mkdir()
        self.patch = mock.patch.object(gateway, "ROOT", self.root)
        self.patch.start()
        handler = type("IsolatedHandler", (gateway.GatewayHandler,), {"service": gateway.LiveService(source, key="offline-fixture", now=lambda: NOW), "request_times": [], "rate_lock": threading.Lock()})
        self.server = gateway.GatewayServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.patch.stop()
        self.tmp.cleanup()

    def request(self, path, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_live_endpoint_is_read_only_and_has_security_headers(self):
        status, headers, body = self.request("/api/live")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["mode"], "live")
        self.assertEqual(headers["Referrer-Policy"], "strict-origin-when-cross-origin")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(self.request("/api/live", "POST")[0], 405)

    def test_checkout_paths_arbitrary_queries_and_traversal_are_not_served(self):
        for path in ["/.env", "/server/live_gateway.py", "/package.json", "/api/live?url=http://private.invalid", "/assets/%2e%2e/%2e%2e/.env"]:
            self.assertIn(self.request(path)[0], [400, 404])

    def test_symlink_cannot_escape_static_root(self):
        outside = self.root.parent / (self.root.name + "-private")
        outside.write_text("private fixture")
        try:
            (self.root / "assets" / "escape.json").symlink_to(outside)
            self.assertEqual(self.request("/assets/escape.json")[0], 404)
        finally:
            outside.unlink()

    def test_rate_limit_is_bounded_without_creating_per_client_buckets(self):
        self.server.RequestHandlerClass.request_times[:] = [time.monotonic()] * 60
        self.assertEqual(self.request("/api/live")[0], 429)


if __name__ == "__main__":
    unittest.main()
