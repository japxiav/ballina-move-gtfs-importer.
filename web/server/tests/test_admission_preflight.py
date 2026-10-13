"""Offline contracts; no production calls or actual credential material."""
import http.client
import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
import schedule_admission_guard as guard
import update_live_gateway_render as update
import deploy_journey_api_supabase as edge
import deploy_live_gateway_render as create
import run_live_gateway_deployment as lifecycle
spec = importlib.util.spec_from_file_location('admission_fixture_gateway', ROOT / 'web/server/live_gateway.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
PRIVATE = 'a' * 64  # Explicit deterministic test fixture, not a real binding.
PROTOCOL = {'version': 1, 'source': 'journey-api', 'admission': 'gateway-secret-v1', 'quotaConsumed': False, 'snapshotRead': False}


class AdmissionPreflight(unittest.TestCase):
    def test_new_source_missing_malformed_or_proxy_placeholder_binding_never_publishes(self):
        for value in ['', 'a' * 63, 'A' * 64, 'a' * 65, 'proxy-placeholder', PRIVATE + '\n']:
            with self.subTest(shape=len(value)), mock.patch.dict(os.environ, {'RENDER_API_KEY': 'offline', 'SUPABASE_ACCESS_TOKEN': 'offline', guard.NAME: value}, clear=True):
                with mock.patch.object(update, 'source_commit', return_value='a' * 40), mock.patch.object(update.verify, 'verified_service', return_value=update.PUBLIC_URL), mock.patch.object(update.api, 'request', return_value={}) as api:
                    with self.assertRaises(ValueError): update.main()
                    self.assertEqual(api.call_count, 1)
                    self.assertTrue(all(len(call.args) == 2 for call in api.call_args_list))
                with mock.patch.object(edge.subprocess, 'check_output', return_value=''), mock.patch.object(edge, 'request') as api:
                    with self.assertRaises(ValueError): edge.main()
                    api.assert_not_called()

    def test_retained_legacy_source_does_not_acquire_new_private_requirement(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {}, clear=True):
            root = Path(directory)
            for target, name in [('gateway', 'web/server/live_gateway.py'), ('edge', 'supabase/functions/journey-api/index.ts')]:
                file = root / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_text('retained offline legacy fixture')
                fixture_hash = hashlib.sha256(file.read_bytes()).hexdigest()
                with mock.patch.dict(guard.LEGACY_HASHES, {target: frozenset({fixture_hash})}):
                    self.assertFalse(guard.require_local_binding(root, target))
                    file.write_text('unknown source lacking the admission name')
                    for value in ['', PRIVATE]:
                        with mock.patch.dict(os.environ, {guard.NAME: value}, clear=True), self.assertRaises(ValueError): guard.require_local_binding(root, target)
            with self.assertRaises(ValueError): guard.require_local_binding(root, 'arbitrary')
            (root / 'web/server/live_gateway.py').unlink()
            with self.assertRaises(OSError): guard.require_local_binding(root, 'gateway')

    def test_creator_cannot_provision_private_source_even_if_local_secret_exists(self):
        owners = [{'owner': {'id': 'offline-workspace'}}]; sha = 'a' * 40
        with mock.patch.dict(os.environ, {'RENDER_API_KEY': 'offline', guard.NAME: PRIVATE}, clear=True), mock.patch.object(create, 'request', side_effect=[owners, []]) as api, mock.patch.object(create.subprocess, 'check_output', side_effect=[create.BRANCH, '', sha, sha + '\trefs/heads/' + create.BRANCH]):
            with self.assertRaisesRegex(ValueError, 'private provisioning'): create.main(['--create'])
            self.assertEqual(api.call_count, 2)
            self.assertTrue(all(len(call.args) == 2 for call in api.call_args_list))

    def test_edge_rejects_unreviewed_head_before_management_reads(self):
        for expected in ['', 'b' * 40, 'invalid']:
            with mock.patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'offline', guard.NAME: PRIVATE, 'BALLINA_EXPECTED_SOURCE_COMMIT': expected}, clear=True), mock.patch.object(edge.subprocess, 'check_output', side_effect=['', 'a' * 40]), mock.patch.object(edge, 'request') as api:
                with self.assertRaises(ValueError): edge.main()
                api.assert_not_called()

    def test_browser_environment_is_allowlisted_and_keeps_only_needed_transport(self):
        fixture = {'PATH': '/offline/bin', 'HOME': '/offline/home', 'HTTPS_PROXY': 'http://proxy.invalid:8080', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE': '/offline/chromium', 'NODE_EXTRA_CA_CERTS': '/offline/verified-ca.pem', guard.NAME: PRIVATE, 'RENDER_API_KEY': 'offline-management', 'SUPABASE_ACCESS_TOKEN': 'offline-management', 'GTFS_IMPORT_TOKEN': 'offline-import', 'STADIA_API_KEY': 'offline-paid-provider', 'OTHER_PRIVATE_VALUE': 'offline-private', 'NODE_OPTIONS': '--require=/offline/untrusted.js'}
        with mock.patch.dict(os.environ, fixture, clear=True): value = lifecycle.browser_environment('https://fixture.onrender.com/')
        self.assertEqual(set(value), {'PATH', 'HOME', 'HTTPS_PROXY', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE', 'NODE_EXTRA_CA_CERTS', 'BALLINA_LIVE_URL'})
        self.assertEqual(value['HTTPS_PROXY'], fixture['HTTPS_PROXY'])

    def test_admission_checks_exact_schema_without_promoting_fixture_to_host_proof(self):
        for value in [PROTOCOL, {**PROTOCOL, 'version': True}, {**PROTOCOL, 'quotaConsumed': 0}, {**PROTOCOL, 'private': 'must-not-echo'}, {**PROTOCOL, 'source': 'transport-api'}, {}, None]:
            with mock.patch.dict(os.environ, {guard.NAME: PRIVATE}, clear=True), mock.patch.object(g, 'public_key', return_value='offline-publishable'):
                fetcher = mock.Mock(return_value=value); result = g.admission_check(fetcher)
                self.assertEqual(result['confirmed'], value == PROTOCOL and value is PROTOCOL)
                fetcher.assert_called_once_with('admission', 'offline-publishable')
                self.assertNotIn('must-not-echo', json.dumps(result))
        with mock.patch.dict(os.environ, {}, clear=True):
            fetcher = mock.Mock(); result = g.admission_check(fetcher)
            self.assertFalse(result['confirmed']); self.assertEqual(result['requestsMaximum'], 0); fetcher.assert_not_called()

    def test_private_admission_request_is_fixed_bounded_and_has_no_extra_parameters(self):
        def response(body, headers=None):
            r = mock.MagicMock(); r.__enter__.return_value = r; r.headers = headers or {}
            r.read1.side_effect = io.BytesIO(body).read; return r
        with mock.patch.dict(os.environ, {guard.NAME: PRIVATE}, clear=True), mock.patch.object(g.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = response(json.dumps(PROTOCOL).encode())
            self.assertEqual(g.fetch_source('admission', 'offline-public'), PROTOCOL)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, g.JOURNEY_URL + '?action=admission')
            self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 3)
            self.assertEqual(request.get_header('X-ballina-gateway'), PRIVATE)
            for body, headers in [(b'x' * 1025, {}), (b'{}', {'Content-Length': '1025'}), (b'\xff', {})]:
                opener.return_value.open.return_value = response(body, headers)
                with self.assertRaises((ValueError, UnicodeError)): g.fetch_source('admission', 'offline-public')
            opener.reset_mock()
            with self.assertRaises(ValueError): g.fetch_source('admission', 'offline-public', {'action': 'journeys'})
            opener.assert_not_called()

    def test_probe_worker_has_dns_watchdog_minimal_environment_and_sanitized_output(self):
        good = {'check': 'schedule_admission', 'confirmed': True, 'requestsMaximum': 1, 'scope': 'private credential agreement only; not GTFS, peer identity or host performance', 'quotaConsumed': False, 'snapshotRead': False}
        for output, code in [(good, 0), ({**good, 'private_debug': 'must-not-echo'}, 0), ({'check': 'schedule_admission', 'confirmed': False, 'error': 'private-must-not-echo'}, 1), ({'check': 'schedule_admission', 'confirmed': True}, 1), ([], 0)]:
            runner = mock.Mock(return_value=mock.Mock(stdout=json.dumps(output), returncode=code))
            with mock.patch.dict(os.environ, {'PATH': '/offline/bin', guard.NAME: PRIVATE, 'SUPABASE_ACCESS_TOKEN': 'offline-management', 'RENDER_API_KEY': 'offline-management', 'STADIA_API_KEY': 'offline-paid'}, clear=True):result = g.checked_admission_process(runner)
            self.assertNotIn('must-not-echo', json.dumps(result))
            self.assertEqual(runner.call_args.kwargs['timeout'], 5)
            self.assertEqual(set(runner.call_args.kwargs['env']), {'PATH', guard.NAME})
            self.assertEqual(result['confirmed'], output is good)
        runner = mock.Mock(side_effect=subprocess.TimeoutExpired(['offline'], 5))
        self.assertFalse(g.checked_admission_process(runner)['confirmed']); runner.assert_called_once()

    def test_no_public_gateway_route_or_quota_read_is_added(self):
        handler = type('OfflineHandler', (g.GatewayHandler,), {'request_times': [], 'service': mock.Mock(), 'schedules': mock.Mock()})
        server = g.GatewayServer(('127.0.0.1', 0), handler); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            connection = http.client.HTTPConnection(*server.server_address, timeout=2)
            connection.request('GET', '/api/admission'); response = connection.getresponse()
            self.assertEqual(response.status, 404); response.read(); connection.close()
            self.assertEqual(handler.request_times, []); handler.service.get.assert_not_called(); handler.schedules.get.assert_not_called()
        finally: server.shutdown(); server.server_close(); thread.join()
