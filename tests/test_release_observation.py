import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
import urllib.error
import io
from unittest import mock

spec = importlib.util.spec_from_file_location('release_observation', Path(__file__).parents[1] / 'scripts/release_observation.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
NOW = dt.datetime(2026, 10, 13, 12, tzinfo=dt.timezone.utc)

class ReleaseObservation(unittest.TestCase):
    def catalog(self, **changes):
        return json.dumps({'version': 1, 'source': 'nta_gtfs', 'timezone': 'Europe/Dublin', 'scope': 'stop_to_stop_same_stop_transfers', 'validFrom': '2026-10-07', 'validUntil': '2027-10-07', 'feedVersion': 'official-capture', 'stops': [{}], **changes}).encode()

    def test_expired_catalog_is_not_availability_success(self):
        self.assertFalse(g.summarize('/api/stops', self.catalog(validUntil='2026-10-12'), NOW)['available'])
        self.assertTrue(g.summarize('/api/stops', self.catalog(), NOW)['feedValidToday'])

    def test_partial_source_failure_is_explicit_and_no_rail_gps_is_invented(self):
        body = {'version': 1, 'mode': 'live', 'collectorHealthy': True, 'sources': {x: {'status': 'ready'} for x in ['bus', 'rail', 'departures']}, 'vehicles': [{'mode': 'bus', 'quality': 'gps_observation', 'source': 'nta', 'observedAt': '2026-10-13T12:00:00Z', 'private': 'never-forward'}]}
        summary = g.summarize('/api/live', json.dumps(body).encode(), NOW)
        self.assertEqual(summary['freshBusGpsCount'], 1); self.assertFalse(summary['railObservationTimeKnown'])
        self.assertNotIn('never-forward', json.dumps(summary))
        body['sources']['bus']['status'] = 'unavailable'
        summary = g.summarize('/api/live', json.dumps(body).encode(), NOW)
        self.assertFalse(summary['available']); self.assertEqual(summary['freshBusGpsCount'], 0)

    def test_faults_are_bounded_three_reads_without_raw_error_text(self):
        calls = []
        def failed(path, deadline):
            calls.append(path)
            raise RuntimeError('private token or client address MUST NOT LOG')
        report = g.observe(failed, NOW)
        self.assertEqual(calls, list(g.PATHS)); self.assertFalse(report['allChecksPassed'])
        self.assertNotIn('MUST NOT LOG', json.dumps(report)); self.assertFalse(report['recurringMonitoringEnabled'])

    def test_no_arbitrary_url_or_nonfixed_path_can_be_requested(self):
        with mock.patch.object(g.urllib.request, 'build_opener') as opener:
            with self.assertRaises(ValueError): g.read_public('https://private.invalid', 100)
            opener.assert_not_called()
        with self.assertRaises(ValueError): g.NoRedirect().redirect_request(None)

    def test_large_bodies_and_unexpected_schema_are_not_silently_accepted(self):
        with self.assertRaises(ValueError): g.summarize('/', b'x' * (g.MAX_BYTES + 1), NOW)
        with self.assertRaises(ValueError): g.summarize('/api/stops', b'{"version":99}', NOW)
        with self.assertRaises(ValueError): g.summarize('/api/stops', self.catalog(feedVersion={'secret': 'must-not-forward'}), NOW)
        self.assertFalse(g.summarize('/', b'HTTP error page', NOW)['available'])

    def test_html_shell_success_does_not_claim_browser_or_pilot(self):
        report = g.summarize('/', b'<!doctype html><div id="root"></div>', NOW)
        self.assertTrue(report['available']); self.assertFalse(report['browserVerified'])

    def test_freshness_uses_each_response_time_after_slow_reads(self):
        later = NOW + dt.timedelta(seconds=45)
        clock = mock.Mock(side_effect=[NOW, NOW, NOW, later])
        live = {'version': 1, 'mode': 'live', 'collectorHealthy': True, 'sources': {x: {'status': 'ready'} for x in ['bus', 'rail', 'departures']}, 'vehicles': [{'mode': 'bus', 'quality': 'gps_observation', 'source': 'nta', 'observedAt': '2026-10-13T11:57:20Z'}]}
        payload = {'/': b'<!doctype html><div id="root"></div>', '/api/stops': self.catalog(), '/api/live': json.dumps(live).encode()}
        report = g.observe(lambda path, deadline: payload[path], clock=clock)
        self.assertEqual(report['checks'][-1]['freshBusGpsCount'], 0)
        self.assertEqual(report['checks'][-1]['sampledAt'], later.isoformat())

    def reader(self, response, deadline=100):
        response.__enter__.return_value = response
        opener = mock.Mock(); opener.open.return_value = response
        with mock.patch.object(g.urllib.request, 'build_opener', return_value=opener):
            return g.read_public('/', deadline)

    def test_reader_rejects_declared_and_streamed_oversized_bodies(self):
        response = mock.MagicMock(); response.headers = {'Content-Length': str(g.MAX_BYTES + 1)}
        with mock.patch.object(g.time, 'monotonic', return_value=0):
            with self.assertRaises(ValueError): self.reader(response)
        response.read1.assert_not_called()
        response.headers = {}; source = io.BytesIO(b'x' * (g.MAX_BYTES + 1)); response.read1.side_effect = source.read
        with mock.patch.object(g.time, 'monotonic', return_value=0):
            with self.assertRaises(ValueError): self.reader(response)
        response.__exit__.assert_called()

    def test_reader_rejects_late_eof_and_closes_stalled_response(self):
        response = mock.MagicMock(); response.headers = {}; response.read1.return_value = b''
        with mock.patch.object(g.time, 'monotonic', side_effect=[0, 0, 101]):
            with self.assertRaises(TimeoutError): self.reader(response)
        response.__exit__.assert_called()
        response.read1.side_effect = TimeoutError('private timeout context')
        with mock.patch.object(g.time, 'monotonic', return_value=0):
            with self.assertRaises(TimeoutError): self.reader(response)
        response.__exit__.assert_called()

    def test_cli_watchdog_kills_worker_without_exposing_partial_output(self):
        with mock.patch.object(g.sys, 'argv', ['release_observation.py', '--once']), mock.patch.object(g.subprocess, 'run', side_effect=g.subprocess.TimeoutExpired('worker', 47, output=b'private partial')), mock.patch('builtins.print') as output:
            self.assertEqual(g.main(), 1)
            text = output.call_args.args[0]
            self.assertIn('observation_watchdog_timeout', text)
            self.assertNotIn('private partial', text)
