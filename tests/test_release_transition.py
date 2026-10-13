"""Management inventory is read-only, bounded and cannot approve release."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock
import urllib.error

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import inspect_release_transition as inventory

SERVICE = {'id': inventory.SERVICE, 'name': 'ballina-move-live', 'type': 'web_service', 'repo': 'https://github.com/japxiav/ballina-move-gtfs-importer.', 'branch': 'ops/live-gateway-hosting', 'autoDeploy': 'no', 'serviceDetails': {'url': inventory.PUBLIC, 'runtime': 'docker', 'plan': 'free', 'numInstances': 1}}
LOCAL = {'candidateHead': 'a' * 40, 'cleanSource': True, 'bindingNamesPresentLocally': {}, 'runtimeBindingsMatchVerified': False, 'hostPeerIdentityVerified': False, 'candidateHostedPerformanceVerified': False, 'runtimeSecretValuesQueried': False, 'deploymentPerformed': False, 'quotaConsumed': False, 'edgeSourceMatchesVerified': False}


class ReleaseInventory(unittest.TestCase):
    def test_dry_run_makes_no_network_calls_and_no_readiness_claim(self):
        out = io.StringIO()
        with mock.patch.object(inventory, 'local_report', return_value=LOCAL), mock.patch.object(inventory, 'read_management') as read, mock.patch.object(inventory.subprocess, 'run') as child, contextlib.redirect_stdout(out):
            self.assertEqual(inventory.main([]), 0)
        value = json.loads(out.getvalue()); self.assertEqual(value['mode'], 'dry_run'); self.assertEqual(value['httpRequests'], 0)
        self.assertFalse(value['runtimeBindingsMatchVerified']); read.assert_not_called(); child.assert_not_called()

    def test_valid_inventory_is_only_three_fixed_reads_and_sanitizes_private_metadata(self):
        fetch = mock.Mock(side_effect=[{**SERVICE, 'private_debug': 'must-not-echo'}, [{'deploy': {'status': 'live', 'commit': {'id': 'b' * 40}, 'private_debug': 'must-not-echo'}}], {'name': 'journey-api', 'status': 'ACTIVE', 'version': 2, 'verify_jwt': False, 'private_debug': 'must-not-echo'}])
        with mock.patch.object(inventory, 'local_report', return_value=LOCAL):value = inventory.inspect(fetch)
        self.assertEqual([c.args[0] for c in fetch.call_args_list], ['service', 'deployment', 'function'])
        self.assertTrue(value['managementIdentityConfirmed']); self.assertFalse(value['gatewayCandidateCommitMatches'])
        self.assertFalse(value['runtimeBindingsMatchVerified']); self.assertFalse(value['candidateHostedPerformanceVerified'])
        self.assertFalse(value['runtimeSecretValuesQueried']); self.assertFalse(value['deploymentPerformed']); self.assertFalse(value['quotaConsumed'])
        self.assertNotIn('must-not-echo', json.dumps(value))

    def test_wrong_host_plan_busy_deployment_bad_version_and_source_fault_fail_closed(self):
        function = {'name': 'journey-api', 'status': 'ACTIVE', 'version': 2, 'verify_jwt': False}
        deploy = [{'deploy': {'status': 'live', 'commit': {'id': 'b' * 40}}}]
        for service, deployments, edge in [
            ({**SERVICE, 'serviceDetails': {**SERVICE['serviceDetails'], 'plan': 'paid'}}, deploy, function),
            (SERVICE, [{'deploy': {'status': 'build_in_progress', 'commit': {'id': 'b' * 40}}}], function),
            (SERVICE, deploy, {**function, 'version': True}), (SERVICE, deploy, {**function, 'version': 1000000}),
            (SERVICE, deploy, {**function, 'verify_jwt': True}), (SERVICE, deploy, {**function, 'status': 'FAILED'}),
            (SERVICE, [{'deploy': {'status': 'live', 'commit': {'id': 'secret-must-not-echo'}}}], function),
        ]:
            fetch = mock.Mock(side_effect=[service, deployments, edge])
            with mock.patch.object(inventory, 'local_report', return_value=LOCAL):value = inventory.inspect(fetch)
            self.assertFalse(value['managementIdentityConfirmed']); self.assertLessEqual(fetch.call_count, 3); self.assertNotIn('must-not-echo', json.dumps(value))
        with mock.patch.object(inventory, 'local_report', return_value=LOCAL):
            fetch = mock.Mock(side_effect=RuntimeError('private-must-not-echo')); value = inventory.inspect(fetch)
            fetch.assert_called_once(); self.assertNotIn('must-not-echo', json.dumps(value))

    def test_management_reader_never_redirects_and_bounds_utf8_body_and_deadline(self):
        def response(body, headers=None):
            value = mock.MagicMock(); value.__enter__.return_value = value; value.headers = headers or {}; value.read1.side_effect = io.BytesIO(body).read; return value
        with mock.patch.dict(inventory.os.environ, {'RENDER_API_KEY': 'offline-binding'}, clear=True), mock.patch.object(inventory.urllib.request, 'build_opener') as opener:
            for body, headers in [(b'x' * (inventory.MAX_BYTES + 1), {}), (b'{}', {'Content-Length': str(inventory.MAX_BYTES + 1)}), (b'{}', {'Content-Length': '-1'}), (b'\xff', {})]:
                opener.return_value.open.return_value = response(body, headers)
                with self.assertRaises((ValueError, UnicodeError)):inventory.read_management('service', inventory.time.monotonic() + 30)
            opener.reset_mock()
            with self.assertRaises(ValueError):inventory.read_management('secret-values', inventory.time.monotonic() + 30)
            opener.assert_not_called()
            opener.return_value.open.return_value = response(b'{}')
            with mock.patch.object(inventory.time, 'monotonic', side_effect=[0, 0, 31]):
                with self.assertRaises(ValueError):inventory.read_management('service', 30)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_method(), 'GET'); self.assertEqual(request.full_url, inventory.READS['service'][0])
        with self.assertRaises(ValueError):inventory.NoRedirect().redirect_request(None)
        body = io.BytesIO(b'private-must-not-echo')
        error = urllib.error.HTTPError('https://fixed.invalid', 403, 'private-error', {}, body)
        with mock.patch.dict(inventory.os.environ, {'RENDER_API_KEY': 'offline'}, clear=True), mock.patch.object(inventory.urllib.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(ValueError) as raised:inventory.read_management('service', inventory.time.monotonic() + 30)
            self.assertNotIn('private', str(raised.exception)); self.assertTrue(body.closed)

    def test_inventory_child_has_whole_process_watchdog_and_no_provider_or_runtime_credentials(self):
        out = io.StringIO(); good = {**LOCAL, 'managementIdentityConfirmed': True}
        with mock.patch.dict(inventory.os.environ, {'PATH': '/offline/bin', 'RENDER_API_KEY': 'offline-render', 'SUPABASE_ACCESS_TOKEN': 'offline-management', inventory.NAME: 'a' * 64, 'STADIA_API_KEY': 'offline-provider'}, clear=True), mock.patch.object(inventory.subprocess, 'run', return_value=mock.Mock(stdout=json.dumps(good), returncode=0)) as child, contextlib.redirect_stdout(out):
            self.assertEqual(inventory.main(['--inspect']), 0)
        self.assertEqual(child.call_args.kwargs['timeout'], 32)
        self.assertEqual(set(child.call_args.kwargs['env']), {'PATH', 'RENDER_API_KEY', 'SUPABASE_ACCESS_TOKEN'})
        self.assertTrue(json.loads(out.getvalue())['bindingNamesPresentLocally'][inventory.NAME])
        out = io.StringIO()
        with mock.patch.object(inventory.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['offline'], 32)) as child, contextlib.redirect_stdout(out):
            self.assertEqual(inventory.main(['--inspect']), 1)
        child.assert_called_once(); self.assertFalse(json.loads(out.getvalue())['deploymentPerformed'])
