"""Offline contracts for an authorized free deployment; never calls Render."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest import mock
import urllib.error

spec = importlib.util.spec_from_file_location("deploy_render", Path(__file__).resolve().parents[3] / "scripts/deploy_live_gateway_render.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentSafety(unittest.TestCase):
    def test_only_free_single_read_only_app_is_prepared_without_auto_deploy(self):
        value = deploy.service_payload("offline-workspace")
        self.assertEqual(value["serviceDetails"]["plan"], "free")
        self.assertEqual(value["serviceDetails"]["runtime"], "docker")
        self.assertEqual(value["serviceDetails"]["numInstances"], 1)
        self.assertEqual(value["autoDeployTrigger"], "off")
        self.assertEqual(value["branch"], "ops/live-gateway-hosting")
        self.assertEqual(value["envVars"], [{"key": "BALLINA_PREVIEW_PORT", "value": "10000"}])

    def test_missing_binding_never_calls_network(self):
        with mock.patch.dict(deploy.os.environ, {}, clear=True), mock.patch.object(deploy, "request") as request, mock.patch("sys.argv", ["deploy", "--create"]):
            with self.assertRaisesRegex(ValueError, "RENDER_API_KEY is missing"):
                deploy.main()
            request.assert_not_called()

    def test_header_injection_cannot_echo_a_secret(self):
        with self.assertRaises(ValueError) as error:
            deploy.request("/owners", "fixture-secret\ninvalid")
        self.assertNotIn("fixture-secret", str(error.exception))

    def test_error_body_never_appears_in_output(self):
        failure = urllib.error.HTTPError(deploy.API, 403, "denied", {}, io.BytesIO(b"private-test-response"))
        with mock.patch.object(deploy.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = failure
            with self.assertRaises(ValueError) as error:
                deploy.request("/owners", "offline-test-binding")
        self.assertIn("HTTP 403", str(error.exception))
        self.assertNotIn("private-test-response", str(error.exception))

    def test_redirect_never_receives_deployment_authorization(self):
        with self.assertRaises(ValueError):
            deploy.NoRedirect().redirect_request(None)

    def test_ambiguous_workspace_does_not_create_or_choose_first(self):
        entries = [{"owner": {"id": "one", "name": "One", "email": "private@example.invalid"}}, {"owner": {"id": "two", "name": "Two"}}]
        out = io.StringIO()
        with mock.patch.dict(deploy.os.environ, {"RENDER_API_KEY": "offline-test-binding"}, clear=True), mock.patch.object(deploy, "request", return_value=entries) as request, mock.patch("sys.argv", ["deploy", "--create"]), contextlib.redirect_stdout(out):
            with self.assertRaisesRegex(ValueError, "Choose BALLINA_RENDER_OWNER_ID"):
                deploy.main()
            request.assert_called_once()
        self.assertNotIn("private@example.invalid", out.getvalue())

    def check_no_create(self, git_answers, existing, expected):
        owners = [{"owner": {"id": "offline-workspace"}}]
        with mock.patch.dict(deploy.os.environ, {"RENDER_API_KEY": "offline-test-binding"}, clear=True), mock.patch.object(deploy, "request", side_effect=[owners, existing]) as request, mock.patch("sys.argv", ["deploy", "--create"]), mock.patch.object(deploy.subprocess, "check_output", side_effect=git_answers):
            with self.assertRaisesRegex(ValueError, expected):
                deploy.main()
            # Creation adds a third body argument; all observed calls are GET.
            self.assertTrue(all(len(call.args) == 2 for call in request.call_args_list))

    def test_dirty_checkout_never_creates_service(self):
        self.check_no_create([deploy.BRANCH, " M web/Dockerfile"], [], "clean reviewed")

    def test_remote_commit_mismatch_never_creates_service(self):
        self.check_no_create([deploy.BRANCH, "", "a" * 40, "b" * 40 + "\trefs/heads/" + deploy.BRANCH], [], "sources differ")

    def test_existing_service_is_not_overwritten_or_duplicated(self):
        head = "a" * 40
        self.check_no_create([deploy.BRANCH, "", head, head + "\trefs/heads/" + deploy.BRANCH], [{"service": {"id": "offline-service"}}], "already exists")


if __name__ == "__main__":
    unittest.main()
