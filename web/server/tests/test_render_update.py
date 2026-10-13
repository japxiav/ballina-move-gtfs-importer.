import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
import update_live_gateway_render as update

SHA = 'a' * 40
ENV = {'BALLINA_EXPECTED_SOURCE_COMMIT': SHA, 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/ops/live-gateway-hosting', 'GITHUB_SHA': SHA, 'RENDER_API_KEY': 'offline-only'}
def git(args, **kwargs):
    if args[1:3] == ['rev-parse', 'HEAD']: return SHA
    if args[1:3] == ['status', '--porcelain']: return ''
    if args[1:3] == ['branch', '--show-current']: return 'ops/live-gateway-hosting'
    if args[1] == 'ls-remote': return SHA + '\trefs/heads/ops/live-gateway-hosting'
    raise AssertionError(args)

class UpdateSafety(unittest.TestCase):
    def test_manual_exact_reviewed_branch_and_clean_tree_required(self):
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(update.subprocess, 'check_output', side_effect=git):
            self.assertEqual(update.source_commit(ROOT), SHA)
            for key, value in [('GITHUB_EVENT_NAME', 'push'), ('GITHUB_REF', 'refs/heads/main'), ('GITHUB_SHA', 'b' * 40), ('BALLINA_EXPECTED_SOURCE_COMMIT', 'invalid')]:
                with mock.patch.dict(os.environ, {key: value}):
                    with self.assertRaises(ValueError): update.source_commit(ROOT)
            for target, replacement in [('status', ' M user-source.py'), ('branch', 'main'), ('ls-remote', 'b' * 40 + '\trefs/heads/ops/live-gateway-hosting')]:
                def changed(args, **kwargs): return replacement if args[1] == target else git(args, **kwargs)
                with mock.patch.object(update.subprocess, 'check_output', side_effect=changed):
                    with self.assertRaises(ValueError): update.source_commit(ROOT)

    def test_wrong_existing_service_prevents_any_deploy_post(self):
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(update, 'source_commit', return_value=SHA), mock.patch.object(update.api, 'request', return_value={}) as request:
            with self.assertRaises(ValueError): update.main()
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.args[0], '/services/' + update.SERVICE_ID)

    def test_only_fixed_existing_deployment_is_requested_and_child_has_no_credentials(self):
        calls = []
        def api(path, key, body=None):
            calls.append((path, body))
            if body is not None: return {'id': 'dep-offline'}
            if path.endswith('/dep-offline'): return {'id': 'dep-offline', 'status': 'live', 'commit': {'id': SHA}}
            return {}
        with mock.patch.dict(os.environ, {**ENV, 'SUPABASE_ACCESS_TOKEN': 'offline-management-only'}, clear=True), mock.patch.object(update, 'source_commit', return_value=SHA), mock.patch.object(update.api, 'request', side_effect=api), mock.patch.object(update.verify, 'verified_service', return_value=update.PUBLIC_URL), mock.patch.object(update.subprocess, 'run', return_value=mock.Mock(returncode=0)) as browser:
            update.main()
            self.assertEqual([(p, b) for p, b in calls if b is not None], [('/services/' + update.SERVICE_ID + '/deploys', {'commitId': SHA})])
            self.assertNotIn('RENDER_API_KEY', browser.call_args.kwargs['env'])
            self.assertNotIn('SUPABASE_ACCESS_TOKEN', browser.call_args.kwargs['env'])

    def test_manual_update_and_create_are_exclusive_and_use_existing_serial_gate(self):
        workflow = (ROOT / '.github/workflows/web-validation.yml').read_text()
        self.assertIn('inputs.update_live_gateway == true && inputs.deploy_live_gateway != true', workflow)
        self.assertIn('inputs.deploy_live_gateway == true && inputs.update_live_gateway != true', workflow)
        self.assertIn('needs: web-validation', workflow)
        self.assertIn('group: ballina-live-gateway-deploy', workflow)
        self.assertIn('inputs.reviewed_source_commit == github.sha', workflow)
        deploy = workflow.split('  deploy-live-gateway:')[1]
        self.assertIn('ref: ${{ github.sha }}', deploy)
        self.assertNotIn('ref: ${{ github.ref_name }}', deploy)
        self.assertIn('git switch -c ops/live-gateway-hosting', deploy)

    def test_queued_deployment_without_commit_polls_until_live_with_exact_source(self):
        steps = iter([{'id': 'dep-offline', 'status': 'queued'}, {'id': 'dep-offline', 'status': 'build_in_progress', 'commit': {'id': SHA}}, {'id': 'dep-offline', 'status': 'live', 'commit': {'id': SHA}}])
        def api(path, key, body=None):
            if body is not None: return {'id': 'dep-offline'}
            if path.endswith('/dep-offline'): return next(steps)
            return {}
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(update, 'source_commit', return_value=SHA), mock.patch.object(update.api, 'request', side_effect=api), mock.patch.object(update.verify, 'verified_service', return_value=update.PUBLIC_URL), mock.patch.object(update.time, 'sleep'), mock.patch.object(update.subprocess, 'run', return_value=mock.Mock(returncode=0)) as browser:
            update.main(); browser.assert_called_once()

    def test_live_missing_or_mismatched_commit_and_unknown_status_never_launch_browser(self):
        for deploy in [{'id': 'dep-offline', 'status': 'live'}, {'id': 'dep-offline', 'status': 'live', 'commit': {'id': 'b' * 40}}, {'id': 'dep-offline', 'status': 'unknown'}]:
            def api(path, key, body=None):
                return {'id': 'dep-offline'} if body is not None else deploy if path.endswith('/dep-offline') else {}
            with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(update, 'source_commit', return_value=SHA), mock.patch.object(update.api, 'request', side_effect=api), mock.patch.object(update.verify, 'verified_service', return_value=update.PUBLIC_URL), mock.patch.object(update.subprocess, 'run') as browser:
                with self.assertRaises(ValueError): update.main()
                browser.assert_not_called()
