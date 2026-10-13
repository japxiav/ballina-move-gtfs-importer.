import email.parser
import email.policy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock
ROOT = Path(__file__).parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
import deploy_journey_api_supabase as deploy

class IsolatedPublication(unittest.TestCase):
    def test_package_contains_exact_reviewed_sources_and_metadata_without_credential(self):
        body, content_type, hashes = deploy.package(ROOT)
        message = email.parser.BytesParser(policy=email.policy.default).parsebytes(('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
        parts = list(message.iter_parts()); self.assertEqual(len(parts), 3)
        metadata = json.loads(parts[0].get_payload(decode=True)); self.assertEqual(metadata['name'], 'journey-api'); self.assertFalse(metadata['verify_jwt'])
        self.assertEqual(metadata['entrypoint_path'], deploy.FILES[0]); self.assertEqual([p.get_filename() for p in parts[1:]], deploy.FILES)
        self.assertEqual(set(hashes), set(deploy.FILES))

    def test_existing_or_malformed_function_list_never_posts(self):
        for value in [[{'slug': 'journey-api'}], [{}], ['invalid'], [{'slug': 'other', 'name': 'journey-api'}], {'not': 'list'}]:
            with mock.patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'offline-only'}, clear=True), mock.patch.object(deploy.subprocess, 'check_output', side_effect=['', 'a' * 40]), mock.patch.object(deploy, 'request', return_value=value) as api:
                with self.assertRaises(ValueError): deploy.main()
                self.assertEqual(api.call_count, 1); self.assertEqual(api.call_args.args[0], '/functions')

    def test_missing_binding_or_dirty_source_never_reads_management_api(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(deploy, 'request') as api:
            with self.assertRaises(ValueError): deploy.main()
            api.assert_not_called()
        with mock.patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'offline-only'}, clear=True), mock.patch.object(deploy.subprocess, 'check_output', return_value=' M user-code.ts'), mock.patch.object(deploy, 'request') as api:
            with self.assertRaises(ValueError): deploy.main()
            api.assert_not_called()

    def test_header_controls_and_redirect_never_send_credentials(self):
        for key in ['', 'invalid\r\nHeader: leak', 'x' * 513]:
            with mock.patch.object(deploy.urllib.request, 'build_opener') as opener:
                with self.assertRaises(ValueError): deploy.request('/functions', key)
                opener.assert_not_called()
        with self.assertRaises(ValueError): deploy.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.example')

    def test_update_only_accepts_the_inspected_existing_version_and_never_recreates(self):
        good = {'slug': 'journey-api', 'version': 1, 'status': 'ACTIVE', 'verify_jwt': False}
        for existing in [[], [{**good, 'version': 2}], [{**good, 'verify_jwt': True}], [{**good, 'status': 'FAILED'}], [{**good, 'slug': 'other', 'name': 'journey-api'}]]:
            with mock.patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'offline-only', 'BALLINA_SUPABASE_EXPECTED_VERSION': '1'}, clear=True), mock.patch.object(deploy.subprocess, 'check_output', side_effect=['', 'a' * 40]), mock.patch.object(deploy, 'request', return_value=existing) as api:
                with self.assertRaises(ValueError): deploy.main()
                self.assertEqual(api.call_count, 1)
        with mock.patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'offline-only', 'BALLINA_SUPABASE_EXPECTED_VERSION': '1'}, clear=True), mock.patch.object(deploy.subprocess, 'check_output', side_effect=['', 'a' * 40]), mock.patch.object(deploy, 'request', side_effect=[[good], {**good, 'version': 2}]) as api:
            deploy.main(); self.assertEqual(api.call_count, 2)
            self.assertEqual(api.call_args.args[0], '/functions/deploy?slug=journey-api')
