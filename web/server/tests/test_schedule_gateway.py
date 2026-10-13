import datetime as dt
import http.client
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('schedule_test_gateway', Path(__file__).parents[1] / 'live_gateway.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
NOW = dt.datetime(2026, 10, 13, 12, tzinfo=dt.timezone.utc)
Q = {'from': 'A', 'to': 'B', 'date': '2026-10-13', 'time': '08:00', 'modes': 'bus,rail', 'changes': '2'}
BASE = {'version': 1, 'source': 'nta_gtfs', 'timezone': 'Europe/Dublin', 'scope': 'stop_to_stop_same_stop_transfers', 'feedVersion': 'official-version', 'loadedAt': '2026-10-13T12:00:00Z'}
STOP = {'id': 'A', 'name': 'Official stop', 'code': '123', 'lat': 54.11, 'lon': -9.15, 'private_key': 'never-forward'}
def result():
    ride = {'tripId': 'trip1', 'route': '420', 'mode': 'bus', 'destination': 'Hospital', 'from': STOP, 'to': {**STOP, 'id': 'B'}, 'boardAt': 29000, 'alightAt': 31920, 'serviceDate': '2026-10-13', 'private_debug': 'never-forward'}
    return {**BASE, 'serviceDate': Q['date'], 'walkingIncluded': False, 'realTimeApplied': False, 'predictionType': 'scheduled', 'minBoardingSeconds': 60, 'minTransferSeconds': 120, 'journeys': [{'id': 'x', 'departureAt': 29000, 'arrivalAt': 31920, 'changes': 0, 'rides': [ride]}], 'secret': 'never-forward'}

class ScheduleGateway(unittest.TestCase):
    def test_duplicate_parameters_past_date_remote_url_and_invalid_modes_are_rejected(self):
        query = g.urllib.parse.urlencode(Q)
        self.assertEqual(g.schedule_query(query, NOW), Q)
        for suffix in ['&date=2026-10-13', '&url=https://private.example', '&apikey=fixture']:
            with self.assertRaises(ValueError): g.schedule_query(query + suffix, NOW)
        for key, value in [('date', '2026-10-11'), ('date', '2026-11-20'), ('date', '2026-02-30'), ('changes', '3'), ('modes', 'ferry'), ('from', 'https://private.example')]:
            with self.assertRaises(ValueError): g.schedule_query(g.urllib.parse.urlencode({**Q, key: value}), NOW)

    def test_public_dto_removes_private_fields_at_every_level(self):
        body = json.dumps(g.public_schedule(result(), Q))
        self.assertNotIn('never-forward', body)
        self.assertNotIn('secret', body)
        self.assertIn('nta_gtfs', body)
        self.assertIn('"realTimeApplied": false', body)

    def test_schedule_cannot_claim_live_prediction_or_walking(self):
        for key, value in [('source', 'demo'), ('realTimeApplied', True), ('walkingIncluded', True), ('serviceDate', '2026-10-11'), ('minTransferSeconds', 0)]:
            with self.assertRaises(ValueError): g.public_schedule({**result(), key: value}, Q)

    def test_wrong_destination_time_mode_and_bay_connections_fail_closed(self):
        for key, value in [('boardAt', 28859), ('alightAt', 0), ('mode', 'ferry'), ('serviceDate', '2026-10-01')]:
            body = result(); body['journeys'][0]['rides'][0][key] = value
            with self.assertRaises(ValueError): g.public_schedule(body, Q)
        body = result(); body['journeys'][0]['rides'][0]['to'] = {**STOP, 'id': 'other-bay'}
        with self.assertRaises(ValueError): g.public_schedule(body, Q)

    def test_catalog_duplicates_invalid_coordinates_and_dates_fail(self):
        valid = {**BASE, 'stops': [STOP], 'validFrom': '2026-10-07', 'validUntil': '2027-10-07'}
        self.assertNotIn('private_key', g.public_schedule(valid)['stops'][0])
        for value in [{**valid, 'stops': [STOP, STOP]}, {**valid, 'stops': [{**STOP, 'lat': 0}]}, {**valid, 'validUntil': '2026-02-30'}]:
            with self.assertRaises(ValueError): g.public_schedule(value)

    def test_stuck_loaders_never_queue_unbounded_new_requests(self):
        release = threading.Event()
        def loader(*args):
            release.wait(3)
            return result()
        service = g.ScheduleService(loader, key='offline')
        try:
            # Force immediate response timeout, retaining the two actual workers.
            with mock.patch.object(g.concurrent.futures.Future, 'result', side_effect=TimeoutError):
                for _ in range(2):
                    with self.assertRaises(TimeoutError): service.get(Q)
            with self.assertRaisesRegex(ValueError, 'schedule_capacity'): service.get(Q)
            self.assertEqual(len(service.futures), 2)
        finally:
            release.set(); service.pool.shutdown(wait=True)

    def test_real_http_rejects_query_and_credentials_paths_without_loader_calls(self):
        schedules = mock.Mock(); handler = type('TestHandler', (g.GatewayHandler,), {'schedules': schedules, 'request_times': []})
        server = g.GatewayServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for path, status in [('/api/stops?url=http://private.example', 400), ('/api/journeys?from=A', 400), ('/server/live_gateway.py', 404), ('/.env', 404)]:
                connection = http.client.HTTPConnection(*server.server_address, timeout=2); connection.request('GET', path)
                response = connection.getresponse(); self.assertEqual(response.status, status); response.read(); connection.close()
            schedules.get.assert_not_called()
        finally:
            server.shutdown(); server.server_close(); thread.join()
