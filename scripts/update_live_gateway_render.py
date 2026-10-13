"""Update only the previously authorized free app, at an exact reviewed commit."""
import json
import os
from pathlib import Path
import re
import subprocess
import time

import deploy_live_gateway_render as api
import run_live_gateway_deployment as verify
from schedule_admission_guard import require_local_binding

SERVICE_ID = 'srv-db6nhvrbc2fs739pb7mg'
PUBLIC_URL = 'https://ballina-move-live.onrender.com/'


def source_commit(root):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
    expected = os.environ.get('BALLINA_EXPECTED_SOURCE_COMMIT', '')
    if not re.fullmatch(r'[a-f0-9]{40}', expected) or git('rev-parse', 'HEAD') != expected or git('status', '--porcelain'):
        raise ValueError('Update requires the clean exact reviewed source.')
    if git('branch', '--show-current') != api.BRANCH or os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch' or os.environ.get('GITHUB_REF') != 'refs/heads/' + api.BRANCH or os.environ.get('GITHUB_SHA') != expected:
        raise ValueError('Update requires the manual reviewed hosting branch workflow.')
    if git('ls-remote', 'origin', 'refs/heads/' + api.BRANCH).split()[0] != expected:
        raise ValueError('Remote hosting branch differs from reviewed source.')
    return expected


def main():
    root = Path(__file__).resolve().parents[1]
    expected = source_commit(root)
    key = os.environ.get('RENDER_API_KEY')
    if not key:
        raise ValueError('Secure Render binding is missing.')
    service = api.request('/services/' + SERVICE_ID, key)
    if verify.verified_service(service, SERVICE_ID) != PUBLIC_URL:
        raise ValueError('Existing service URL differs from the authorized app.')
    require_local_binding(root, 'gateway')
    # No service creation, plan/config changes, deletion, clear-cache or retries.
    response = api.request('/services/' + SERVICE_ID + '/deploys', key, {'commitId': expected})
    if not isinstance(response, dict) or not isinstance(response.get('id'), str) or not re.fullmatch(r'dep-[a-z0-9]+', response['id']):
        raise ValueError('Unexpected update response; inspect existing deployment before retrying.')
    deployment_id = response['id']
    print('::notice title=Render update requested::' + json.dumps({'serviceId': SERVICE_ID, 'deploymentId': deployment_id, 'sourceCommit': expected, 'plan': 'free'}), flush=True)
    deadline = time.monotonic() + 600
    while True:
        current = api.request('/services/' + SERVICE_ID, key)
        if verify.verified_service(current, SERVICE_ID) != PUBLIC_URL:
            raise ValueError('Service configuration changed during deployment.')
        deploy = api.request('/services/' + SERVICE_ID + '/deploys/' + deployment_id, key)
        if not isinstance(deploy, dict) or deploy.get('id') != deployment_id:
            raise ValueError('Deployment differs from exact requested source.')
        commit = deploy.get('commit')
        if commit is not None and not isinstance(commit, dict):
            raise ValueError('Deployment commit differs from reviewed source.')
        actual_commit = commit.get('id') if commit else None
        if actual_commit is not None and actual_commit != expected:
            raise ValueError('Deployment commit differs from reviewed source.')
        if deploy.get('status') == 'live':
            if actual_commit != expected:
                raise ValueError('Live deployment did not prove the exact reviewed commit.')
            break
        if deploy.get('status') not in {'created', 'queued', 'build_in_progress', 'pre_deploy_in_progress', 'update_in_progress'} or time.monotonic() > deadline:
            raise ValueError('Update failed or timed out; no automatic retry or paid upgrade.')
        time.sleep(10)
    print('::notice title=Render deployed source verified::' + json.dumps({'serviceId': SERVICE_ID, 'url': PUBLIC_URL, 'sourceCommit': expected}), flush=True)
    env = verify.browser_environment(PUBLIC_URL)
    result = subprocess.run(['node', 'web/scripts/check-live-host.cjs'], cwd=root, env=env)
    if result.returncode:
        raise ValueError('Actual hosted browser verification failed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError):
        print('Reviewed app update failed; no credentials or private responses logged.')
        raise SystemExit(1)
