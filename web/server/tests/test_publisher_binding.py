"""Publisher reads one app binding; never creates a secret or deploys."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
import publisher_admission_binding as publisher
import update_live_gateway_render as update
from schedule_admission_guard import NAME

VALUE = 'a' * 64  # Explicit offline fixture, never the configured secret.


class PublisherBinding(unittest.TestCase):
    def test_binding_is_read_only_from_fixed_store_and_not_written_to_environment(self):
        reader = mock.Mock(return_value={'key': NAME, 'value': VALUE, 'private_debug': 'must-not-echo'})
        with mock.patch.dict(os.environ, {'BALLINA_LOAD_SCHEDULE_SECRET_FROM_RENDER': '1'}, clear=True):
            before = dict(os.environ)
            self.assertTrue(publisher.require_publisher_binding(ROOT, 'offline-manager', reader))
            self.assertEqual(dict(os.environ), before)
        reader.assert_called_once_with('/services/' + publisher.SERVICE + '/env-vars/' + NAME, 'offline-manager')

    def test_missing_opt_in_and_malformed_nonempty_binding_make_no_private_lookup(self):
        for environment in [{}, {NAME: 'proxy-placeholder', 'BALLINA_LOAD_SCHEDULE_SECRET_FROM_RENDER': '1'}, {'BALLINA_LOAD_SCHEDULE_SECRET_FROM_RENDER': 'true'}]:
            with mock.patch.dict(os.environ, environment, clear=True):
                reader = mock.Mock()
                with self.assertRaises(ValueError):publisher.require_publisher_binding(ROOT, 'offline-manager', reader)
                reader.assert_not_called()
        with mock.patch.dict(os.environ, {NAME: VALUE}, clear=True):
            reader = mock.Mock(); self.assertTrue(publisher.require_publisher_binding(ROOT, 'offline-manager', reader));reader.assert_not_called()

    def test_wrong_name_schema_shape_and_remote_fault_never_echo_or_publish(self):
        for response in [None, [], {'key': 'OTHER_SECRET', 'value': VALUE}, {'key': NAME, 'value': VALUE + '\n'}, {'key': NAME, 'value': 'private-must-not-echo'}, {'envVar': 'invalid'}, {'key': NAME, 'value': True}]:
            reader = mock.Mock(return_value=response)
            with self.assertRaises(ValueError) as raised:publisher.configured_value('offline-manager', reader)
            self.assertNotIn('must-not-echo', str(raised.exception))
        reader = mock.Mock(return_value={'envVar': {'key': NAME, 'value': VALUE}})
        self.assertEqual(publisher.configured_value('offline-manager', reader), VALUE)

    def test_read_only_probe_keeps_value_out_of_stdout_and_requires_verified_service(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {'RENDER_API_KEY': 'offline-manager'}, clear=True), mock.patch.object(publisher.api, 'request', side_effect=[{}, {'key': NAME, 'value': VALUE}]) as reader, mock.patch.object(publisher, 'verified_service', return_value=publisher.PUBLIC), contextlib.redirect_stdout(out):
            publisher.main()
        report = json.loads(out.getvalue());self.assertTrue(report['confirmed']);self.assertFalse(report['deploymentAttempted'])
        self.assertNotIn(VALUE, out.getvalue());self.assertEqual(reader.call_count, 2)
        self.assertTrue(all(len(c.args)==2 for c in reader.call_args_list))
        with mock.patch.dict(os.environ, {'RENDER_API_KEY': 'offline'}, clear=True), mock.patch.object(publisher.api, 'request', return_value={}) as reader:
            with self.assertRaises(ValueError):publisher.main()
            reader.assert_called_once()

    def test_update_retrieval_failure_never_requests_deployment_or_runs_browser(self):
        environment = {'RENDER_API_KEY': 'offline-manager', 'BALLINA_LOAD_SCHEDULE_SECRET_FROM_RENDER': '1'}
        with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(update, 'source_commit', return_value='a'*40), mock.patch.object(update.verify, 'verified_service', return_value=update.PUBLIC_URL), mock.patch.object(update.api, 'request', side_effect=[{}, {'key': NAME, 'value': 'invalid'}]) as request, mock.patch.object(update.subprocess, 'run') as browser:
            with self.assertRaises(ValueError):update.main()
            self.assertEqual(request.call_count, 2);self.assertTrue(all(len(c.args)==2 for c in request.call_args_list));browser.assert_not_called()

    def test_probe_workflow_is_manual_exclusive_and_has_no_deployment_step(self):
        source = (ROOT / '.github/workflows/web-validation.yml').read_text()
        probe = source.split('  publisher-binding-probe:')[1].split('  deploy-live-gateway:')[0]
        self.assertIn("github.event_name == 'workflow_dispatch'", probe)
        self.assertIn('inputs.deploy_live_gateway != true', probe);self.assertIn('inputs.update_live_gateway != true', probe)
        self.assertIn('ref: ${{ github.sha }}', probe);self.assertIn('python scripts/publisher_admission_binding.py', probe)
        self.assertNotIn('update_live_gateway_render.py', probe);self.assertNotIn('deploy_live_gateway_render.py', probe)
        deploy = source.split('  deploy-live-gateway:')[1]
        self.assertIn('inputs.publisher_binding_probe != true', deploy)
        self.assertIn('BALLINA_LOAD_SCHEDULE_SECRET_FROM_RENDER: "1"', deploy)
        self.assertNotIn('secrets.BALLINA_JOURNEY_GATEWAY_SECRET', source)
