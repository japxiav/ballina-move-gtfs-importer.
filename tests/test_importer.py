import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest import mock
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("import_gtfs", ROOT / "import_gtfs.py")
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def csv_text(headers, rows):
    out = io.StringIO(newline="")
    import csv
    w = csv.writer(out)
    w.writerow(headers)
    w.writerows(rows)
    return out.getvalue()


class ImporterTests(unittest.TestCase):
    def make_feed(self, path: Path):
        files = {
            "agency.txt": csv_text(["agency_id","agency_name","agency_url","agency_timezone"], [["A","Bus Eireann","https://x","Europe/Dublin"]]),
            "feed_info.txt": csv_text(["feed_publisher_name","feed_publisher_url","feed_lang","feed_start_date","feed_end_date","feed_version"], [["NTA","https://x","en","20261006","20271006","v1"]]),
            "routes.txt": csv_text(["route_id","agency_id","route_short_name","route_long_name","route_type"], [["R1","A","420","Ballina - Castlebar","3"]]),
            "stops.txt": csv_text(["stop_id","stop_name","stop_lat","stop_lon"], [["S1","Ballina Bus Stn","54.11101","-9.1599"],["S2","Castlebar","53.85","-9.3"]]),
            "trips.txt": csv_text(["route_id","service_id","trip_id","trip_headsign","direction_id","shape_id"], [["R1","WK","T1","Castlebar","0","SH1"]]),
            "stop_times.txt": csv_text(["trip_id","arrival_time","departure_time","stop_id","stop_sequence"], [["T1","09:00:00","09:00:00","S1","1"],["T1","09:30:00","09:30:00","S2","2"]]),
            "calendar.txt": csv_text(["service_id","monday","tuesday","wednesday","thursday","friday","saturday","sunday","start_date","end_date"], [["WK","1","1","1","1","1","0","0","20261006","20271006"]]),
            "calendar_dates.txt": csv_text(["service_id","date","exception_type"], []),
            "shapes.txt": csv_text(["shape_id","shape_pt_lat","shape_pt_lon","shape_pt_sequence"], [["SH1","54.111","-9.16","1"],["SH1","53.85","-9.3","2"]]),
        }
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for name, content in files.items():
                z.writestr(name, content)

    def test_gtfs_time_over_24h(self):
        self.assertEqual(mod.gtfs_seconds("25:10:05"), 90605)

    def test_target_exact_id_has_coordinate_sanity(self):
        stops = {"S1":{"stop_id":"S1","stop_name":"Ballina Bus Stn","stop_lat":54.11101,"stop_lon":-9.1599}}
        target = mod.Target("ballina","S1","Ballina Bus Stn",54.11101,-9.1599,500)
        ids, audit = mod.resolve_targets(stops,[target])
        self.assertEqual(ids,{"S1"})
        self.assertEqual(audit[0]["match"],"exact_id")

    def test_end_to_end_selection_uses_disk_sqlite(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"feed.zip"; self.make_feed(p)
            f=mod.FeedReader(p)
            try:
                stops=mod.collect_stops(f)
                target=mod.Target("ballina","S1","Ballina Bus Stn",54.11101,-9.1599,500)
                monitored,_=mod.resolve_targets(stops,[target])
                configs={"R1":mod.RouteConfig("R1","420","local_trips")}
                routes=mod.collect_routes(f,configs)
                trips=mod.collect_trips(f,routes)
                db=sqlite3.connect(":memory:")
                try:
                    mod.spool_stop_times(f,trips,db)
                    selected=mod.select_trips(db,trips,configs,monitored)
                    self.assertEqual(selected,{"T1"})
                    rows=list(mod.selected_stop_times(db,selected,monitored))
                    self.assertEqual(len(rows),2)
                    self.assertTrue(rows[0]["monitored"])
                finally:
                    db.close()
            finally:
                f.close()


    def test_coordinate_fallback_rejects_ambiguous_pair(self):
        stops = {
            "N1":{"stop_id":"N1","stop_name":"Foxford","stop_lat":53.98115,"stop_lon":-9.11072},
            "N2":{"stop_id":"N2","stop_name":"Foxford","stop_lat":53.98116,"stop_lon":-9.11080},
        }
        target = mod.Target("foxford",None,"Foxford",53.981155,-9.11076,350)
        with self.assertRaises(RuntimeError):
            mod.resolve_targets(stops,[target])

    def test_exact_id_reused_far_away_is_rejected(self):
        stops = {"S1":{"stop_id":"S1","stop_name":"Ballina","stop_lat":52.80,"stop_lon":-8.43}}
        target = mod.Target("ballina","S1","Ballina",54.11,-9.16,500)
        with self.assertRaises(RuntimeError):
            mod.resolve_targets(stops,[target])

    def test_all_trips_scope_does_not_require_target_stop(self):
        db=sqlite3.connect(":memory:")
        try:
            db.execute("create table st(trip_id text,stop_id text)")
            db.execute("insert into st values('T1','OTHER')")
            trips={"T1":{"route_id":"R1"}}
            cfg={"R1":mod.RouteConfig("R1","420","all_trips")}
            self.assertEqual(mod.select_trips(db,trips,cfg,{"TARGET"}),{"T1"})
        finally:
            db.close()

    def test_missing_required_file_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"bad.zip"
            with zipfile.ZipFile(p,"w") as z:
                z.writestr("stops.txt","stop_id,stop_name\n")
            with self.assertRaises(RuntimeError):
                mod.FeedReader(p)

    def test_target_collision_is_rejected(self):
        stops = {"S1":{"stop_id":"S1","stop_name":"Ballina","stop_lat":54.11,"stop_lon":-9.16}}
        targets = [
            mod.Target("a","S1","Ballina",54.11,-9.16,500),
            mod.Target("b","S1","Ballina",54.11,-9.16,500),
        ]
        with self.assertRaises(RuntimeError):
            mod.resolve_targets(stops, targets)

    def test_subset_validation_rejects_partial_shape_coverage(self):
        with self.assertRaisesRegex(RuntimeError, "selected_shape_missing"):
            mod.validate_subset(
                selected_routes=[{"route_id":"R","agency_id":"A"}],
                selected_stops=[{"stop_id":"S1"},{"stop_id":"S2"}],
                chosen_trip_rows=[{"trip_id":"T","route_id":"R","service_id":"WK","shape_id":"SH2"}],
                stop_times_rows=[{"trip_id":"T","stop_id":"S1"},{"trip_id":"T","stop_id":"S2"}],
                agency_rows=[{"agency_id":"A"}],
                calendar_rows=[{"service_id":"WK"}],
                calendar_date_rows=[],
                shape_rows=[{"shape_id":"SH1"}],
            )

    def test_subset_validation_rejects_missing_service_calendar(self):
        with self.assertRaisesRegex(RuntimeError, "selected_service_calendar_missing"):
            mod.validate_subset(
                selected_routes=[{"route_id":"R","agency_id":"A"}],
                selected_stops=[{"stop_id":"S1"},{"stop_id":"S2"}],
                chosen_trip_rows=[{"trip_id":"T","route_id":"R","service_id":"WK","shape_id":None}],
                stop_times_rows=[{"trip_id":"T","stop_id":"S1"},{"trip_id":"T","stop_id":"S2"}],
                agency_rows=[{"agency_id":"A"}],
                calendar_rows=[],
                calendar_date_rows=[],
                shape_rows=[],
            )

    def test_subset_validation_rejects_short_trip(self):
        with self.assertRaisesRegex(RuntimeError, "fewer_than_two_stops"):
            mod.validate_subset(
                selected_routes=[{"route_id":"R","agency_id":"A"}],
                selected_stops=[{"stop_id":"S1"}],
                chosen_trip_rows=[{"trip_id":"T","route_id":"R","service_id":"WK","shape_id":None}],
                stop_times_rows=[{"trip_id":"T","stop_id":"S1"}],
                agency_rows=[{"agency_id":"A"}],
                calendar_rows=[{"service_id":"WK"}],
                calendar_date_rows=[],
                shape_rows=[],
            )

    def test_conditional_download_uses_304(self):
        payload = b"PK-test-gtfs"

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get("If-None-Match") == '"audit-etag"':
                    self.send_response(304)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("ETag", '"audit-etag"')
                self.send_header("Last-Modified", "Tue, 06 Oct 2026 09:00:00 GMT")
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/feed.zip"
            with tempfile.TemporaryDirectory() as d:
                first = mod.download(url, Path(d) / "first.zip")
                self.assertFalse(first.not_modified)
                self.assertEqual(first.size, len(payload))
                self.assertEqual(first.etag, '"audit-etag"')

                second = mod.download(
                    url,
                    Path(d) / "second.zip",
                    if_modified_since=first.last_modified,
                    if_none_match=first.etag,
                )
                self.assertTrue(second.not_modified)
                self.assertIsNone(second.sha256)
                self.assertEqual(second.etag, '"audit-etag"')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_feed_window_must_include_today(self):
        info = {"feed_start_date":"2026-10-01","feed_end_date":"2026-10-31"}
        mod.validate_feed_window(info, mod.date(2026,10,6))
        with self.assertRaisesRegex(RuntimeError, "feed_not_current"):
            mod.validate_feed_window(info, mod.date(2026,11,1))

    def test_missing_expected_csv_column_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad-columns.zip"
            self.make_feed(p)
            # Rebuild the archive with routes.txt missing route_type.
            files = {}
            with zipfile.ZipFile(p, "r") as z:
                for name in z.namelist():
                    files[name] = z.read(name)
            files["routes.txt"] = csv_text(["route_id","agency_id","route_short_name"], [["R1","A","420"]]).encode()
            with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
                for name, content in files.items():
                    z.writestr(name, content)
            feed = mod.FeedReader(p)
            try:
                with self.assertRaisesRegex(RuntimeError, "gtfs_missing_columns:routes.txt"):
                    list(feed.rows("routes.txt"))
            finally:
                feed.close()

    def test_fallback_name_requires_more_than_one_generic_token(self):
        self.assertFalse(mod.target_name_matches("Ballina Bus Stn", "Ballina Shopping Centre"))
        self.assertTrue(mod.target_name_matches("Ballina Bus Stn", "Ballina Bus Station"))
        self.assertTrue(mod.target_name_matches("Foxford", "Foxford Station"))

    def test_exact_id_must_stay_within_configured_radius(self):
        # Roughly 650m north of the expected point, inside the old 1500m guard
        # but outside the configured 500m radius.
        stops = {"S1":{"stop_id":"S1","stop_name":"Ballina","stop_lat":54.1169,"stop_lon":-9.16}}
        target = mod.Target("ballina","S1","Ballina",54.1110,-9.16,500)
        with self.assertRaisesRegex(RuntimeError, "target_exact_id_moved"):
            mod.resolve_targets(stops, [target])

    def test_duplicate_stop_time_key_is_not_silently_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "dupe.zip"
            self.make_feed(p)
            with zipfile.ZipFile(p, "r") as z:
                files = {name: z.read(name) for name in z.namelist()}
            files["stop_times.txt"] = csv_text(
                ["trip_id","arrival_time","departure_time","stop_id","stop_sequence"],
                [
                    ["T1","09:00:00","09:00:00","S1","1"],
                    ["T1","09:01:00","09:01:00","S2","1"],
                ],
            ).encode()
            with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
                for name, content in files.items():
                    z.writestr(name, content)
            f = mod.FeedReader(p)
            try:
                routes = mod.collect_routes(f, {"R1":mod.RouteConfig("R1","420","all_trips")})
                trips = mod.collect_trips(f, routes)
                db = sqlite3.connect(":memory:")
                try:
                    with self.assertRaises(sqlite3.IntegrityError):
                        mod.spool_stop_times(f, trips, db)
                finally:
                    db.close()
            finally:
                f.close()

    def test_monitored_stop_requires_real_time_value(self):
        with self.assertRaisesRegex(RuntimeError, "monitored_stop_time_missing_time"):
            mod.validate_upcoming_target_service(
                monitored_stop_ids={"S1"},
                chosen_trip_rows=[{"trip_id":"T1","service_id":"WK"}],
                stop_times_rows=[{
                    "trip_id":"T1","stop_id":"S1","stop_sequence":1,
                    "arrival_seconds":None,"departure_seconds":None,
                }],
                calendar_rows=[{
                    "service_id":"WK","monday":True,"tuesday":True,"wednesday":True,
                    "thursday":True,"friday":True,"saturday":True,"sunday":True,
                    "start_date":"2026-10-01","end_date":"2026-10-31",
                }],
                calendar_date_rows=[],
                today=mod.date(2026,10,6),
            )

    def test_target_requires_service_within_next_7_days(self):
        with self.assertRaisesRegex(RuntimeError, "monitored_target_no_service_next_7_days"):
            mod.validate_upcoming_target_service(
                monitored_stop_ids={"S1"},
                chosen_trip_rows=[{"trip_id":"T1","service_id":"WK"}],
                stop_times_rows=[{
                    "trip_id":"T1","stop_id":"S1","stop_sequence":1,
                    "arrival_seconds":3600,"departure_seconds":3600,
                }],
                calendar_rows=[{
                    "service_id":"WK","monday":False,"tuesday":False,"wednesday":False,
                    "thursday":False,"friday":False,"saturday":False,"sunday":False,
                    "start_date":"2026-10-01","end_date":"2026-10-31",
                }],
                calendar_date_rows=[],
                today=mod.date(2026,10,6),
            )

    def test_future_feed_is_classified_for_defer_not_generic_failure(self):
        state, today, start, end = mod.feed_window_state(
            {"feed_start_date":"2026-10-20","feed_end_date":"2027-10-20"},
            mod.date(2026,10,6),
        )
        self.assertEqual(state, "future")
        self.assertEqual(start, mod.date(2026,10,20))

    def _fake_supabase_for_run(self, *, finalize_error=None, feed_active_after_error=False):
        class FakeSupabase:
            def __init__(self):
                self.patches = []
                self.get_queries = []
                self.aborts = []
                self.finalize_calls = []
                self.validate_calls = []
                self.download_kwargs = None

            def claim_import_lock(self, owner, ttl_seconds=2700):
                return {"lock_id":"lock-1"}

            def release_import_lock(self, lock_id):
                return True

            def start_run(self, **kwargs):
                return "run-1"

            def update_run(self, run_id, row):
                self.patches.append(("gtfs_import_runs", run_id, row))

            def previous_http_state(self, source_url, config_sha256):
                self.get_queries.append(("gtfs_import_runs", f"config_sha256=eq.{config_sha256}"))
                return {}

            def begin_import(self, **kwargs):
                return {"exists":False,"active":False}

            def import_batch(self, version, kind, rows):
                return len(rows)

            def validate_staging(self, version):
                self.validate_calls.append(version)
                return {"version":version,"validated":True}

            def finalize(self, version):
                self.finalize_calls.append(version)
                if finalize_error is not None:
                    raise finalize_error
                return {"version":version,"activated":True}

            def feed_state(self, version):
                return {
                    "version":version,
                    "active":bool(feed_active_after_error and self.finalize_calls),
                }

            def abort_import(self, version):
                self.aborts.append(version)
                return True

        return FakeSupabase()

    def _run_with_fake_supabase(self, fake, *, dry_run=False, force=False):
        target = mod.Target("ballina", "S1", "Ballina Bus Stn", 54.11101, -9.1599, 500)
        configs = {"R1":mod.RouteConfig("R1", "420", "local_trips")}

        def fake_download(url, destination, **kwargs):
            fake.download_kwargs = kwargs
            self.make_feed(destination)
            return mod.DownloadResult(
                sha256="a" * 64,
                size=destination.stat().st_size,
                last_modified="Tue, 06 Oct 2026 09:00:00 GMT",
                etag='"etag-1"',
                not_modified=False,
            )

        args = mod.argparse.Namespace(url="https://example.test/feed.zip", dry_run=dry_run, force=force)
        with mock.patch.dict(mod.os.environ, {"SUPABASE_PUBLISHABLE_KEY":"pk-test"}, clear=False), \
             mock.patch.object(mod, "Supabase", return_value=fake), \
             mock.patch.object(mod, "env_required", return_value="x"), \
             mock.patch.object(mod, "load_config", return_value=([target], configs, "old-active")), \
             mock.patch.object(mod, "download", side_effect=fake_download):
            return mod.run(args)

    def test_dry_run_stages_database_validation_and_cleans_up(self):
        fake = self._fake_supabase_for_run()
        result = self._run_with_fake_supabase(fake, dry_run=True)
        self.assertEqual(result["status"], "dry_run_ok")
        self.assertEqual(len(fake.validate_calls), 1)
        self.assertEqual(len(fake.aborts), 1)
        self.assertEqual(fake.finalize_calls, [])
        self.assertIsNone(fake.download_kwargs.get("if_none_match"))
        self.assertIsNone(fake.download_kwargs.get("if_modified_since"))

    def test_finalize_timeout_reconciles_active_version_without_abort(self):
        fake = self._fake_supabase_for_run(
            finalize_error=TimeoutError("response lost after commit"),
            feed_active_after_error=True,
        )
        result = self._run_with_fake_supabase(fake, dry_run=False, force=True)
        self.assertEqual(result["status"], "activated_reconciled")
        self.assertEqual(fake.aborts, [])
        self.assertTrue(any(
            row.get("metadata", {}).get("finalize_reconciled_after_error")
            for _, _, row in fake.patches
        ))

    def test_conditional_lookup_is_scoped_to_current_config_hash(self):
        fake = self._fake_supabase_for_run()
        result = self._run_with_fake_supabase(fake, dry_run=False, force=False)
        self.assertEqual(result["status"], "activated")
        conditional_queries = [q for table, q in fake.get_queries if table == "gtfs_import_runs"]
        self.assertEqual(len(conditional_queries), 1)
        self.assertIn("config_sha256=eq.", conditional_queries[0])

    def test_import_rpc_calls_edge_gateway_not_public_rest_rpc(self):
        sb = mod.Supabase("https://example.supabase.co", "pk", "import-token")
        with mock.patch.object(sb, "_request", return_value={"ok":True}) as request:
            result = sb.rpc(
                "get_gtfs_import_config",
                {"p_token":"import-token"},
                retries=2,
            )
        self.assertEqual(result, {"ok":True})
        args, kwargs = request.call_args
        self.assertEqual(args[0], "POST")
        self.assertEqual(args[1], "/functions/v1/gtfs-import-api")
        self.assertEqual(args[2]["action"], "config")
        self.assertEqual(args[2]["import_token"], "import-token")
        self.assertNotIn("p_token", args[2]["params"])
        self.assertEqual(kwargs["retries"], 2)


if __name__ == "__main__":
    unittest.main()
