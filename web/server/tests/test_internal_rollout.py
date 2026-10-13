"""Offline prerequisites; values and management responses are explicit fixtures."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import unittest
from unittest import mock

ROOT = Path(__file__).parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
import check_internal_rollout as check
import deploy_journey_api_supabase as edge
from schedule_admission_guard import NAME

VALUE = 'b' * 64  # Offline fixture, not the configured binding.
SHA = 'a' * 40
FUNCTION = {'slug': 'journey-api', 'version': 3, 'status': 'ACTIVE', 'verify_jwt': False}
SECRET = {'name': NAME, 'value': hashlib.sha256(VALUE.encode()).hexdigest()}
ENV = {'RENDER_API_KEY': 'offline-render', 'SUPABASE_ACCESS_TOKEN': 'offline-edge',
       'BALLINA_EXPECTED_SOURCE_COMMIT': SHA, 'BALLINA_SUPABASE_EXPECTED_VERSION': '3'}


class InternalRollout(unittest.TestCase):
    def run_check(self, functions=None, secrets=None, verified=True):
        out = io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(check, 'checked_source', return_value=SHA), mock.patch.object(check.publisher.api, 'request', side_effect=[{}, {'key': NAME, 'value': VALUE}]) as render, mock.patch.object(check.publisher, 'verified_service', return_value=check.publisher.PUBLIC if verified else 'https://wrong.invalid/'), mock.patch.object(check.edge, 'request', side_effect=[[FUNCTION] if functions is None else functions, [SECRET] if secrets is None else secrets]) as supabase, mock.patch.object(edge, 'package') as package, contextlib.redirect_stdout(out):
            before = dict(os.environ)
            try:
                result = check.main()
            finally:
                self.assertEqual(dict(os.environ), before)
                self.assertNotIn(VALUE, out.getvalue())
                self.assertNotIn(SECRET['value'], out.getvalue())
                package.assert_not_called()
                self.assertTrue(all(len(c.args) == 2 for c in render.call_args_list + supabase.call_args_list))
        return result, render, supabase

    def test_cli_worker_has_dns_inclusive_watchdog_and_allowlisted_environment(self):
        result, _, _ = self.run_check()
        runner = mock.Mock(return_value=mock.Mock(returncode=0, stdout=json.dumps(result)))
        with mock.patch.dict(os.environ, {**ENV, 'HTTPS_PROXY': 'http://offline.invalid', NAME: VALUE, 'GTFS_IMPORT_TOKEN': 'must-not-copy', 'PYTHONPATH': 'must-not-inject'}, clear=True):
            self.assertEqual(check.checked_process(runner), result)
        self.assertEqual(runner.call_args.kwargs['timeout'], 35)
        self.assertEqual(set(runner.call_args.kwargs['env']), set(ENV) | {'HTTPS_PROXY'})
        self.assertEqual(runner.call_args.args[0][-1], '--worker')
        runner = mock.Mock(side_effect=subprocess.TimeoutExpired(['offline'], 35))
        self.assertEqual(check.checked_process(runner), check.failure())
        runner.assert_called_once()

    def test_worker_failures_and_unknown_fields_never_echo_private_output(self):
        result, _, _ = self.run_check()
        for payload, code in [(json.dumps({**result, 'private': VALUE}), 0), (json.dumps({**result, 'confirmed': 1}), 0), (json.dumps({**result, 'deploymentAttempted': True}), 0), (json.dumps({**result, 'sourceCommit': 'b'*40}), 0), (VALUE, 1), ('x'*2049, 0)]:
            runner = mock.Mock(return_value=mock.Mock(returncode=code, stdout=payload))
            with mock.patch.dict(os.environ, ENV, clear=True): safe = check.checked_process(runner)
            self.assertEqual(safe, check.failure())
            self.assertNotIn(VALUE, json.dumps(safe))

    def test_matching_configuration_uses_four_fixed_reads_and_never_publishes(self):
        result, render, supabase = self.run_check()
        self.assertTrue(result['serverStoresMatch'])
        self.assertFalse(result['runtimeAdmissionVerified'])
        self.assertFalse(result['passengerReleaseApproved'])
        self.assertEqual([c.args[0] for c in render.call_args_list], ['/services/' + check.publisher.SERVICE, '/services/' + check.publisher.SERVICE + '/env-vars/' + NAME])
        self.assertEqual([c.args[0] for c in supabase.call_args_list], ['/functions', '/secrets'])

    def test_stale_or_ambiguous_function_inventory_fails_closed(self):
        for functions in [[{**FUNCTION, 'version': 2}], [{**FUNCTION, 'version': True}], [{**FUNCTION, 'verify_jwt': True}], [{**FUNCTION, 'status': 'FAILED'}], [FUNCTION, FUNCTION], [], [{}], {'bad': 'shape'}]:
            with self.subTest(functions=functions), self.assertRaises(ValueError):
                self.run_check(functions=functions)

    def test_absent_mismatched_or_malformed_digest_never_publishes_or_echoes(self):
        for secrets in [[], [SECRET, SECRET], [{'name': NAME, 'value': 'a' * 64}], [{'name': NAME, 'value': True}], [{'name': 'OTHER', 'value': SECRET['value']}], [{}], {'bad': 'shape'}]:
            with self.subTest(secrets=secrets), self.assertRaises(ValueError):
                self.run_check(secrets=secrets)
        with self.assertRaises(ValueError): self.run_check(verified=False)

    def test_dirty_or_unreviewed_source_and_missing_version_make_no_api_calls(self):
        for outputs, expected in [([' M user.ts'], SHA), (['', SHA], ''), (['', SHA], 'b' * 40)]:
            with mock.patch.dict(os.environ, {**ENV, 'BALLINA_EXPECTED_SOURCE_COMMIT': expected}, clear=True), mock.patch.object(check.subprocess, 'check_output', side_effect=outputs), mock.patch.object(check.publisher.api, 'request') as render, mock.patch.object(check.edge, 'request') as supabase:
                with self.assertRaises(ValueError): check.main()
                render.assert_not_called(); supabase.assert_not_called()
        with mock.patch.dict(os.environ, {**ENV, 'BALLINA_SUPABASE_EXPECTED_VERSION': ''}, clear=True), mock.patch.object(check, 'checked_source', return_value=SHA), mock.patch.object(check.publisher.api, 'request') as reader:
            with self.assertRaises(ValueError): check.main()
            reader.assert_not_called()

    def test_edge_publisher_accepts_transient_binding_without_environment_export(self):
        for value in [VALUE, 'proxy-placeholder', 'A' * 64, '']:
            with mock.patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'offline-edge', 'BALLINA_EXPECTED_SOURCE_COMMIT': SHA, 'BALLINA_SUPABASE_EXPECTED_VERSION': '3'}, clear=True), mock.patch.object(edge.subprocess, 'check_output', side_effect=['', SHA]), mock.patch.object(edge, 'request', side_effect=[[FUNCTION], {**FUNCTION, 'version': 4}]) as api, contextlib.redirect_stdout(io.StringIO()) as out:
                before = dict(os.environ)
                if value == VALUE:
                    edge.main(binding=value)
                    self.assertEqual(api.call_count, 2)
                else:
                    with self.assertRaises(ValueError): edge.main(binding=value)
                    api.assert_not_called()
                self.assertEqual(dict(os.environ), before)
                self.assertNotIn(VALUE, out.getvalue())
