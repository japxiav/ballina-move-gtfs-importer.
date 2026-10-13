import contextlib
import datetime as dt
import http.client
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
from unittest import mock
import urllib.error

spec = importlib.util.spec_from_file_location('safe_errors_gateway', Path(__file__).parents[1] / 'live_gateway.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

class SafeScheduleFailures(unittest.TestCase):
    def fetch_error(self, status, body, retry=None):
        headers = {} if retry is None else {'Retry-After': retry}
        error = urllib.error.HTTPError('https://fixed-source.invalid', status, 'offline', headers, io.BytesIO(body))
        with mock.patch.object(g.urllib.request, 'build_opener') as builder:
            builder.return_value.open.side_effect = error
            with self.assertRaises(g.SafeScheduleError) as raised:
                g.fetch_source('journeys', 'offline-publishable')
        return raised.exception

    def test_known_upstream_errors_are_sanitized_and_rate_wait_is_bounded(self):
        err = self.fetch_error(429, b'private token MUST NOT BE FORWARDED', '999')
        self.assertEqual((err.status, err.code, err.retry_after), (429, 'rate_limited', 60))
        for status, code in [(400, 'unknown_stop'), (400, 'date_outside_feed'), (503, 'clock_change_unsupported'), (503, 'search_capacity_reached')]:
            err = self.fetch_error(status, json.dumps({'error': code, 'secret': 'never-forward'}).encode())
            self.assertEqual((err.status, err.code), (status, code))
            self.assertNotIn('never-forward', str(err))
        err = self.fetch_error(400, b'{"error":"private SQL secret"}')
        self.assertEqual((err.status, err.code), (503, 'schedules_unavailable'))

    def test_malformed_retry_header_cannot_inject_headers_or_remove_backoff(self):
        for value in ['0', '-1', 'none', '60\r\nX-Secret: leak']:
            self.assertEqual(self.fetch_error(429, b'{}', value).retry_after, 60)

    def test_invalid_queries_do_not_spend_shared_source_quota(self):
        handler = type('OfflineHandler', (g.GatewayHandler,), {'request_times': [], 'schedules': mock.Mock(), 'service': mock.Mock()})
        server = g.GatewayServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for _ in range(65):
                c = http.client.HTTPConnection(*server.server_address, timeout=2)
                c.request('GET', '/api/journeys?from=A'); r = c.getresponse()
                self.assertEqual(r.status, 400); r.read(); c.close()
            self.assertEqual(handler.request_times, []); handler.schedules.get.assert_not_called()
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_http_preserves_safe_429_without_private_upstream_body(self):
        schedules = mock.Mock(); schedules.get.side_effect = g.SafeScheduleError(429, 'rate_limited', 60)
        handler = type('OfflineHandler', (g.GatewayHandler,), {'request_times': [], 'schedules': schedules})
        server = g.GatewayServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            c = http.client.HTTPConnection(*server.server_address, timeout=2); c.request('GET', '/api/stops')
            r = c.getresponse(); self.assertEqual(r.status, 429); self.assertEqual(r.getheader('Retry-After'), '60')
            self.assertEqual(json.loads(r.read()), {'error': 'rate_limited'}); c.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_unhandled_request_error_logs_neither_address_nor_traceback(self):
        server = g.GatewayServer(('127.0.0.1', 0), g.GatewayHandler)
        try:
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                server.handle_error(None, ('198.51.100.2', 12345))
            self.assertNotIn('198.51.100.2', output.getvalue())
            self.assertNotIn('Traceback', output.getvalue())
            self.assertIn('gateway_request_failed', output.getvalue())
        finally: server.server_close()
