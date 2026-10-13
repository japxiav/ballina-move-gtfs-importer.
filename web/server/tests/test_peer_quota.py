import concurrent.futures
import datetime as dt
import http.client
import importlib.util
import io
import json
from pathlib import Path
import threading
import time
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('peer_quota_gateway', Path(__file__).parents[1] / 'live_gateway.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)


class PeerQuotas(unittest.TestCase):
    def test_atomic_budget_keeps_other_peer_available(self):
        budget = g.PeerBudget(clock=lambda: 0)
        a, b = budget.identity('192.0.2.1'), budget.identity('192.0.2.2')
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            allowed = list(pool.map(lambda _: budget.allow(a, '/api/journeys'), range(40)))
        self.assertEqual(sum(allowed), 6)
        self.assertTrue(budget.allow(b, '/api/journeys'))

    def test_expiry_and_memory_cap_do_not_evict_live_limits(self):
        now = [0]; budget = g.PeerBudget(clock=lambda: now[0], maximum=2)
        a, b, c = [budget.identity(f'192.0.2.{i}') for i in (1, 2, 3)]
        self.assertTrue(budget.allow(a, '/api/journeys')); self.assertTrue(budget.allow(b, '/api/journeys'))
        self.assertFalse(budget.allow(c, '/api/journeys')); self.assertEqual(len(budget.buckets), 2)
        now[0] = 60
        self.assertTrue(budget.allow(c, '/api/journeys')); self.assertEqual(len(budget.buckets), 1)

    def test_ipv6_rotation_and_raw_addresses_do_not_escape_or_persist(self):
        budget = g.PeerBudget(clock=lambda: 0)
        a = budget.identity('2001:db8:1234:1::1')
        self.assertEqual(a, budget.identity('2001:db8:1234:1::ffff'))
        budget.allow(a, '/api/journeys')
        self.assertNotIn('2001:db8', repr(budget.buckets))
        self.assertNotEqual(a, g.PeerBudget().identity('2001:db8:1234:1::1'))
        self.assertEqual(budget.identity('::ffff:192.0.2.1'), budget.identity('192.0.2.1'))
        self.assertNotEqual(budget.identity('::ffff:192.0.2.1'), budget.identity('::ffff:192.0.2.2'))

    def test_global_rejection_does_not_spend_or_create_peer_buckets(self):
        handler = type('FullHandler', (g.GatewayHandler,), {'request_times': [time.monotonic()] * 60, 'service': mock.Mock(), 'rate_lock': threading.Lock()})
        server = g.GatewayServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            connection = http.client.HTTPConnection(*server.server_address, timeout=2)
            connection.request('GET', '/api/live'); response = connection.getresponse()
            self.assertEqual(response.status, 429); response.read(); connection.close()
            self.assertEqual(server.client_budget.buckets, {})
            handler.service.get.assert_not_called()
        finally: server.shutdown(); server.server_close(); thread.join()

    def test_cold_parallel_catalog_and_journey_share_catalog_without_rejecting_normal_search(self):
        release, both = threading.Event(), threading.Event(); calls = []; lock = threading.Lock()
        base = {'version': 1, 'source': 'nta_gtfs', 'feedVersion': 'offline', 'loadedAt': '2026-10-13T00:00:00Z', 'timezone': 'Europe/Dublin', 'scope': 'stop_to_stop_same_stop_transfers'}
        query = {'from': 'A', 'to': 'B', 'date': '2026-10-13', 'time': '08:00', 'modes': 'bus', 'changes': '0'}
        def loader(name, key, params):
            with lock:
                calls.append(name)
                if len(calls) == 2: both.set()
            release.wait(2)
            if name == 'stops': return {**base, 'validFrom': '2026-10-07', 'validUntil': '2027-10-07', 'stops': [{'id': x, 'name': 'Offline ' + x, 'code': x, 'lat': 54.1, 'lon': -9.1} for x in ['A', 'B']]}
            return {**base, 'serviceDate': query['date'], 'walkingIncluded': False, 'realTimeApplied': False, 'predictionType': 'scheduled', 'minBoardingSeconds': 60, 'minTransferSeconds': 120, 'journeys': []}
        service = g.ScheduleService(loader, key='offline')
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as callers:
            catalog = callers.submit(service.get, None, client='a' * 64)
            while not calls: time.sleep(.001)
            journey = callers.submit(service.get, query, client='a' * 64)
            shared = callers.submit(service.get, None, client='b' * 64)
            try:
                self.assertTrue(both.wait(.5))
                release.set()
                self.assertEqual(len(catalog.result(timeout=1)['stops']), 2)
                self.assertEqual(journey.result(timeout=1)['journeys'], [])
                self.assertEqual(shared.result(timeout=1), catalog.result())
                self.assertEqual(sorted(calls), ['journeys', 'stops'])
                self.assertLessEqual(len(service.futures), 2)
            finally: release.set(); service.pool.shutdown(wait=True)

    def test_real_http_header_rotation_does_not_spend_other_peer_budget(self):
        schedules = mock.Mock(); schedules.get.return_value = {'scope': 'offline-quota-contract'}
        handler = type('QuotaHandler', (g.GatewayHandler,), {'schedules': schedules, 'request_times': [], 'rate_lock': threading.Lock()})
        server = g.GatewayServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        today = dt.datetime.now(g.UTC).astimezone(g.ZoneInfo('Europe/Dublin')).date().isoformat()
        path = '/api/journeys?' + g.urllib.parse.urlencode({'from': 'A', 'to': 'B', 'date': today, 'time': '08:00', 'modes': 'bus', 'changes': '0'})
        def read(peer, forwarded):
            connection = http.client.HTTPConnection(*server.server_address, timeout=2, source_address=(peer, 0))
            connection.request('GET', path, headers={'X-Forwarded-For': forwarded, 'X-Real-IP': forwarded, 'Cookie': 'identity=' + forwarded})
            response = connection.getresponse(); response.read(); status = response.status; connection.close(); return status
        try:
            for i in range(6): self.assertEqual(read('127.0.0.2', f'192.0.2.{i}'), 200)
            for i in range(3): self.assertEqual(read('127.0.0.2', f'198.51.100.{i}'), 429)
            self.assertEqual(len(handler.request_times), 6)
            self.assertEqual(read('127.0.0.3', '192.0.2.1'), 200)
            self.assertEqual(len(handler.request_times), 7)
            self.assertEqual(schedules.get.call_count, 7)
        finally: server.shutdown(); server.server_close(); thread.join()

    def test_hung_caller_keeps_one_worker_and_cannot_block_a_second_peer(self):
        release = threading.Event(); entered = threading.Event()
        stop = {'id': 'A', 'name': 'Fixture A', 'code': 'A', 'lat': 54.1, 'lon': -9.1}
        base = {'version': 1, 'source': 'nta_gtfs', 'feedVersion': 'offline', 'loadedAt': '2026-10-13T00:00:00Z', 'timezone': 'Europe/Dublin', 'scope': 'stop_to_stop_same_stop_transfers'}
        query = {'from': 'A', 'to': 'B', 'date': '2026-10-13', 'time': '08:00', 'modes': 'bus', 'changes': '0'}
        result = {**base, 'serviceDate': query['date'], 'walkingIncluded': False, 'realTimeApplied': False, 'predictionType': 'scheduled', 'minBoardingSeconds': 60, 'minTransferSeconds': 120, 'journeys': []}
        def loader(name, key, params):
            if params['time'] == '08:00': entered.set(); release.wait(3)
            return result
        service = g.ScheduleService(loader, key='offline'); failures = []
        def first():
            try: service.get(query, client='a' * 64)
            except Exception as error: failures.append(type(error).__name__)
        worker = threading.Thread(target=first); worker.start()
        try:
            self.assertTrue(entered.wait(1))
            for _ in range(5):
                with self.assertRaisesRegex(ValueError, 'schedule_client_busy'): service.get(query, client='a' * 64)
            self.assertEqual(service.get({**query, 'time': '08:01'}, client='b' * 64)['journeys'], [])
            self.assertLessEqual(len(service.futures), 2)
            self.assertFalse(next(f for f in service.futures if not f.done()).cancel())
            with self.assertRaisesRegex(ValueError, 'schedule_client_busy'): service.get(query, client='a' * 64)
        finally: release.set(); worker.join(2); service.pool.shutdown(wait=True)
        self.assertEqual(failures, [])

    def test_missing_private_gate_configuration_makes_no_request(self):
        with mock.patch.dict(g.os.environ, {}, clear=True), mock.patch.object(g.urllib.request, 'build_opener') as opener:
            with self.assertRaisesRegex(ValueError, 'configuration_missing'): g.fetch_source('stops', 'offline-public')
            opener.assert_not_called()

    def test_private_credential_is_isolated_to_schedule_destinations(self):
        def response():
            value = mock.MagicMock(); value.__enter__.return_value = value; value.headers = {}
            value.read1.side_effect = io.BytesIO(b'{}').read
            return value
        with mock.patch.dict(g.os.environ, {'BALLINA_JOURNEY_GATEWAY_SECRET': 'a' * 64}), mock.patch.object(g.urllib.request, 'build_opener') as opener:
            for name in ['stops', 'journeys', 'health', 'vehicles', 'departures', 'rail']:
                opener.return_value.open.return_value = response()
                g.fetch_source(name, 'offline-publishable')
                request = opener.return_value.open.call_args.args[0]
                headers = {key.lower(): value for key, value in request.header_items()}
                self.assertEqual('x-ballina-gateway' in headers, name in ['stops', 'journeys'])
                if name in ['stops', 'journeys']: self.assertTrue(request.full_url.startswith(g.JOURNEY_URL))
