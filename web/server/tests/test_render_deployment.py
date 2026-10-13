"""Offline contracts for an authorized free deployment; never calls Render."""
import contextlib
import importlib.util
import io
import sys
from pathlib import Path
import unittest
from unittest import mock
import urllib.error

spec = importlib.util.spec_from_file_location("deploy_render", Path(__file__).resolve().parents[3] / "scripts/deploy_live_gateway_render.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import run_live_gateway_deployment as lifecycle


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

    def test_runner_requires_manual_event_ref_and_reviewed_commit_before_create(self):
        head = "a" * 40
        for override in [{"GITHUB_EVENT_NAME": "pull_request"}, {"GITHUB_REF": "refs/heads/main"}, {"BALLINA_EXPECTED_SOURCE_COMMIT": "b" * 40}, {"GITHUB_SHA": "b" * 40}]:
            environment = {"RENDER_API_KEY": "offline-test-binding", "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/" + deploy.BRANCH, "BALLINA_EXPECTED_SOURCE_COMMIT": head, "GITHUB_SHA": head, **override}
            with mock.patch.dict(deploy.os.environ, environment, clear=True), mock.patch.object(deploy, "request", return_value=[{"owner": {"id": "offline-workspace"}}]) as request, mock.patch.object(deploy.subprocess, "check_output", side_effect=[deploy.BRANCH, "", head]):
                with self.assertRaisesRegex(ValueError, "explicit manual event"):
                    deploy.main(["--create"])
                self.assertTrue(all(len(call.args) == 2 for call in request.call_args_list))

    def service(self):
        return {"id": "srv-offline", "name": deploy.NAME, "type": "web_service", "repo": deploy.REPO, "branch": deploy.BRANCH, "autoDeployTrigger": "off",
                "serviceDetails": {"runtime": "docker", "plan": "free", "numInstances": 1, "url": "https://offline-fixture.onrender.com"}}

    def test_only_reviewed_free_service_url_is_accepted(self):
        value = self.service()
        self.assertEqual(lifecycle.verified_service(value, "srv-offline"), "https://offline-fixture.onrender.com/")
        for key, replacement in [("plan", "starter"), ("numInstances", 2), ("runtime", "node"), ("url", "http://offline-fixture.onrender.com"), ("url", "https://secret@offline-fixture.onrender.com"), ("url", "https://evil.invalid")]:
            changed = self.service(); changed["serviceDetails"][key] = replacement
            with self.assertRaises(ValueError):
                lifecycle.verified_service(changed, "srv-offline")
        value["branch"] = "main"
        with self.assertRaises(ValueError):
            lifecycle.verified_service(value, "srv-offline")

    def test_deployment_success_requires_actual_reviewed_commit(self):
        head = "a" * 40
        self.assertTrue(lifecycle.live_commit([{"deploy": {"status": "live", "commit": {"id": head}}}], head))
        self.assertFalse(lifecycle.live_commit([{"deploy": {"status": "build_in_progress", "commit": {"id": head}}}], head))
        for status, commit in [("live", "b" * 40), ("build_failed", head), ("canceled", head)]:
            with self.assertRaises(ValueError):
                lifecycle.live_commit([{"deploy": {"status": status, "commit": {"id": commit}}}], head)

    def test_workflow_does_not_deploy_from_push_or_pull_request(self):
        path = Path(__file__).resolve().parents[3] / ".github/workflows/web-validation.yml"
        text = path.read_text().split("  deploy-live-gateway:")[1]
        self.assertIn("needs: web-validation", text)
        self.assertIn("github.event_name == 'workflow_dispatch'", text)
        self.assertIn("github.ref == 'refs/heads/ops/live-gateway-hosting'", text)
        self.assertIn("inputs.deploy_live_gateway == true", text)
        self.assertIn("inputs.reviewed_source_commit == github.sha", text)
        self.assertIn("BALLINA_EXPECTED_SOURCE_COMMIT: ${{ inputs.reviewed_source_commit }}", text)
        self.assertIn("group: ballina-live-gateway-deploy", text)
        self.assertIn("cancel-in-progress: false", text)

    def test_browser_child_does_not_receive_render_credential(self):
        with mock.patch.dict(deploy.os.environ, {"RENDER_API_KEY": "fixture-secret", "HTTPS_PROXY": "http://proxy.invalid:8080"}, clear=True):
            environment = lifecycle.browser_environment("https://offline-fixture.onrender.com/")
        self.assertNotIn("RENDER_API_KEY", environment)
        self.assertEqual(environment["HTTPS_PROXY"], "http://proxy.invalid:8080")
        self.assertEqual(environment["BALLINA_LIVE_URL"], "https://offline-fixture.onrender.com/")


if __name__ == "__main__":
    unittest.main()
