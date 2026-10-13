"""Read-only prerequisite check; never publish, configure or query journeys."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import deploy_journey_api_supabase as edge
import publisher_admission_binding as publisher
from schedule_admission_guard import NAME, require_local_binding


def checked_source(root):
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip():
        raise ValueError('A clean reviewed source is required.')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    expected = os.environ.get('BALLINA_EXPECTED_SOURCE_COMMIT', '')
    if not re.fullmatch(r'[a-f0-9]{40}', expected) or sha != expected:
        raise ValueError('The exact reviewed source is required.')
    return sha


def main():
    root = Path(__file__).resolve().parents[1]
    sha = checked_source(root)
    version = os.environ.get('BALLINA_SUPABASE_EXPECTED_VERSION', '')
    if not re.fullmatch(r'[1-9]\d{0,5}', version):
        raise ValueError('An inspected configuration version is required.')
    render_key = os.environ.get('RENDER_API_KEY', '')
    edge_key = os.environ.get('SUPABASE_ACCESS_TOKEN', '')
    if not render_key or not edge_key:
        raise ValueError('Existing management bindings are required.')
    service = publisher.api.request('/services/' + publisher.SERVICE, render_key)
    if publisher.verified_service(service, publisher.SERVICE) != publisher.PUBLIC:
        raise ValueError('Unexpected service.')
    value = publisher.configured_value(render_key)
    require_local_binding(root, 'edge', binding=value)
    require_local_binding(root, 'gateway', binding=value)
    functions = edge.request('/functions', edge_key)
    if not isinstance(functions, list) or any(not isinstance(f, dict) for f in functions):
        raise ValueError('Unexpected function inventory.')
    matches = [f for f in functions if f.get('slug') == 'journey-api' or f.get('name') == 'journey-api']
    if len(matches) != 1 or matches[0].get('slug', matches[0].get('name')) != 'journey-api' or type(matches[0].get('version')) is not int or matches[0]['version'] != int(version) or matches[0].get('status') != 'ACTIVE' or matches[0].get('verify_jwt') is not False:
        raise ValueError('Function configuration changed; inspect again.')
    secrets = edge.request('/secrets', edge_key)
    if not isinstance(secrets, list) or any(not isinstance(s, dict) for s in secrets):
        raise ValueError('Unexpected secret inventory.')
    matches = [s for s in secrets if s.get('name') == NAME]
    if len(matches) != 1 or not isinstance(matches[0].get('value'), str) or not re.fullmatch(r'[a-f0-9]{64}', matches[0]['value']) or not hmac.compare_digest(matches[0]['value'], hashlib.sha256(value.encode()).hexdigest()):
        raise ValueError('Server configuration agreement not confirmed.')
    result = {'check': 'internal_rollout_configuration', 'confirmed': True,
              'sourceCommit': sha, 'journeyConfigurationVersion': int(version),
              'serverStoresMatch': True, 'requestsMaximum': 4,
              'deploymentAttempted': False, 'valueExposed': False,
              'runtimeAdmissionVerified': False, 'hostClientIdentityVerified': False,
              'passengerReleaseApproved': False}
    print(json.dumps(result))
    return result


def failure():
    return {'check': 'internal_rollout_configuration', 'confirmed': False,
            'error': 'configuration_unconfirmed', 'deploymentAttempted': False,
            'valueExposed': False, 'runtimeAdmissionVerified': False}


def checked_process(runner=subprocess.run):
    # Socket timeouts do not bound DNS or slow bodies; kill the whole worker.
    allowed = ('PATH', 'HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
               'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy',
               'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE',
               'RENDER_API_KEY', 'SUPABASE_ACCESS_TOKEN',
               'BALLINA_EXPECTED_SOURCE_COMMIT', 'BALLINA_SUPABASE_EXPECTED_VERSION')
    env = {name: os.environ[name] for name in allowed if name in os.environ}
    try:
        child = runner([sys.executable, str(Path(__file__).resolve()), '--worker'],
                       capture_output=True, text=True, timeout=35, env=env)
        if child.returncode != 0 or len(child.stdout) > 2048:
            return failure()
        result = json.loads(child.stdout)
        expected = {'check': 'internal_rollout_configuration', 'confirmed': True,
                    'sourceCommit': env.get('BALLINA_EXPECTED_SOURCE_COMMIT', ''),
                    'journeyConfigurationVersion': int(env.get('BALLINA_SUPABASE_EXPECTED_VERSION', '')),
                    'serverStoresMatch': True, 'requestsMaximum': 4,
                    'deploymentAttempted': False, 'valueExposed': False,
                    'runtimeAdmissionVerified': False, 'hostClientIdentityVerified': False,
                    'passengerReleaseApproved': False}
        if not isinstance(result, dict) or set(result) != set(expected) or any(type(result[k]) is not type(v) or result[k] != v for k, v in expected.items()):
            return failure()
        return expected
    except Exception:
        return failure()


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--worker']:
            main()
        elif not sys.argv[1:]:
            result = checked_process()
            print(json.dumps(result))
            raise SystemExit(0 if result['confirmed'] else 1)
        else:
            raise ValueError('Unsupported invocation.')
    except Exception:
        print(json.dumps(failure()))
        raise SystemExit(1)
