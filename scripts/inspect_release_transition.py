"""Dry-run default; --inspect makes at most three fixed management GETs.

No deployment, secret-value lookup, GTFS/quota read, monitor or approval signal.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from schedule_admission_guard import NAME, requires_private_admission
from run_live_gateway_deployment import verified_service

ROOT = Path(__file__).resolve().parents[1]
SERVICE = 'srv-db6nhvrbc2fs739pb7mg'
PUBLIC = 'https://ballina-move-live.onrender.com/'
READS = {
    'service': ('https://api.render.com/v1/services/' + SERVICE, 'RENDER_API_KEY'),
    'deployment': ('https://api.render.com/v1/services/' + SERVICE + '/deploys?limit=1', 'RENDER_API_KEY'),
    'function': ('https://api.supabase.com/v1/projects/giwiqbnyozjbpmetrjhe/functions/journey-api', 'SUPABASE_ACCESS_TOKEN'),
}
MAX_BYTES = 32768


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('redirect_refused')


def local_report(root=ROOT):
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    clean = not subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip()
    files = ['web/server/live_gateway.py', 'supabase/functions/journey-api/index.ts', 'supabase/functions/transport-api/journeys.ts']
    return {'scope': 'read-only transition inventory, not activation approval', 'candidateHead': head, 'cleanSource': clean,
            'sourceHashes': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in files},
            'requiresPrivateAdmission': {target: requires_private_admission(root, target) for target in ['gateway', 'edge']},
            'bindingNamesPresentLocally': {name: bool(os.environ.get(name)) for name in ['RENDER_API_KEY', 'SUPABASE_ACCESS_TOKEN', NAME]},
            'runtimeBindingsMatchVerified': False, 'hostPeerIdentityVerified': False, 'candidateHostedPerformanceVerified': False,
            'edgeSourceMatchesVerified': False,
            'deploymentPerformed': False, 'runtimeSecretValuesQueried': False, 'quotaConsumed': False, 'recurringMonitoringEnabled': False}


def read_management(name, deadline):
    if name not in READS:
        raise ValueError('unknown_management_target')
    url, binding = READS[name]; key = os.environ.get(binding, '')
    if not key or len(key) > 512 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise ValueError('management_binding_missing')
    remaining = min(12, deadline - time.monotonic())
    if remaining <= 0:
        raise ValueError('inventory_deadline')
    request = urllib.request.Request(url, method='GET', headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json', 'User-Agent': 'BallinaMove-readonly-transition'})
    try:
        response = urllib.request.build_opener(NoRedirect()).open(request, timeout=remaining)
    except urllib.error.HTTPError as error:
        error.close(); raise ValueError('management_unavailable') from None
    with response:
        declared = response.headers.get('Content-Length')
        if declared is not None and (not re.fullmatch(r'[0-9]{1,10}', declared) or int(declared) > MAX_BYTES):
            raise ValueError('management_body_limit')
        body = bytearray()
        while True:
            remaining = min(12, deadline - time.monotonic())
            if remaining <= 0:
                raise ValueError('inventory_deadline')
            socket = getattr(getattr(getattr(response, 'fp', None), 'raw', None), '_sock', None)
            if socket is not None:
                socket.settimeout(remaining)
            chunk = response.read1(min(8192, MAX_BYTES + 1 - len(body)))
            if time.monotonic() >= deadline:
                raise ValueError('inventory_deadline')
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                raise ValueError('management_body_limit')
    return json.loads(body.decode('utf-8', errors='strict'))


def inspect(fetcher=read_management, root=ROOT):
    report = {**local_report(root), 'mode': 'read_only_inventory', 'observedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'requestsMaximum': 3}
    deadline = time.monotonic() + 30
    try:
        service = fetcher('service', deadline)
        if verified_service(service, SERVICE) != PUBLIC:
            raise ValueError('unexpected_service')
        deployments = fetcher('deployment', deadline)
        if not isinstance(deployments, list) or len(deployments) != 1 or not isinstance(deployments[0], dict):
            raise ValueError('unexpected_deployment')
        deployment = deployments[0].get('deploy', deployments[0])
        if not isinstance(deployment, dict) or deployment.get('status') != 'live' or not isinstance(deployment.get('commit'), dict):
            raise ValueError('deployment_unproven')
        commit = deployment['commit'].get('id')
        if not isinstance(commit, str) or not re.fullmatch(r'[a-f0-9]{40}', commit):
            raise ValueError('deployment_unproven')
        function = fetcher('function', deadline)
        if not isinstance(function, dict) or function.get('slug', function.get('name')) != 'journey-api' or type(function.get('version')) is not int or not 1 <= function['version'] <= 999999 or function.get('verify_jwt') is not False or function.get('status') != 'ACTIVE':
            raise ValueError('function_unproven')
        report.update({'managementIdentityConfirmed': True, 'publishedGatewayCommit': commit, 'gatewayCandidateCommitMatches': commit == report['candidateHead'],
                       'servicePlan': 'free', 'autoDeploy': False, 'journeyFunctionVersion': function['version']})
    except Exception:
        report.update({'managementIdentityConfirmed': False, 'error': 'inventory_unavailable_or_unproven'})
    return report


def validate_worker_report(value, returncode):
    flags = {'runtimeBindingsMatchVerified', 'hostPeerIdentityVerified', 'candidateHostedPerformanceVerified', 'edgeSourceMatchesVerified',
             'deploymentPerformed', 'runtimeSecretValuesQueried', 'quotaConsumed', 'recurringMonitoringEnabled'}
    common = {'scope', 'candidateHead', 'cleanSource', 'sourceHashes', 'requiresPrivateAdmission', 'bindingNamesPresentLocally',
              'mode', 'observedAtUtc', 'requestsMaximum', 'managementIdentityConfirmed'} | flags
    if not isinstance(value, dict) or returncode not in {0, 1} or type(value.get('managementIdentityConfirmed')) is not bool or returncode != (0 if value['managementIdentityConfirmed'] else 1):
        raise ValueError('unproven_inventory_worker')
    success = value['managementIdentityConfirmed']
    expected = common | ({'publishedGatewayCommit', 'gatewayCandidateCommitMatches', 'servicePlan', 'autoDeploy', 'journeyFunctionVersion'} if success else {'error'})
    if value.keys() != expected or value['scope'] != 'read-only transition inventory, not activation approval' or value['mode'] != 'read_only_inventory' or type(value['requestsMaximum']) is not int or value['requestsMaximum'] != 3:
        raise ValueError('unproven_inventory_worker')
    if not isinstance(value['candidateHead'], str) or not re.fullmatch(r'[a-f0-9]{40}', value['candidateHead']) or type(value['cleanSource']) is not bool or any(value[k] is not False for k in flags):
        raise ValueError('unproven_inventory_worker')
    sources = {'web/server/live_gateway.py', 'supabase/functions/journey-api/index.ts', 'supabase/functions/transport-api/journeys.ts'}
    if not isinstance(value['sourceHashes'], dict) or value['sourceHashes'].keys() != sources or any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{64}', v) for v in value['sourceHashes'].values()):
        raise ValueError('unproven_inventory_worker')
    for key, names in [('requiresPrivateAdmission', {'gateway', 'edge'}), ('bindingNamesPresentLocally', {'RENDER_API_KEY', 'SUPABASE_ACCESS_TOKEN', NAME})]:
        if not isinstance(value[key], dict) or value[key].keys() != names or any(type(v) is not bool for v in value[key].values()):
            raise ValueError('unproven_inventory_worker')
    if not isinstance(value['observedAtUtc'], str) or len(value['observedAtUtc']) > 40 or dt.datetime.fromisoformat(value['observedAtUtc']).utcoffset() != dt.timedelta(0):
        raise ValueError('unproven_inventory_worker')
    if success:
        if not isinstance(value['publishedGatewayCommit'], str) or not re.fullmatch(r'[a-f0-9]{40}', value['publishedGatewayCommit']) or type(value['gatewayCandidateCommitMatches']) is not bool or value['gatewayCandidateCommitMatches'] != (value['publishedGatewayCommit'] == value['candidateHead']) or value['servicePlan'] != 'free' or value['autoDeploy'] is not False or type(value['journeyFunctionVersion']) is not int or not 1 <= value['journeyFunctionVersion'] <= 999999:
            raise ValueError('unproven_inventory_worker')
    elif value['error'] != 'inventory_unavailable_or_unproven':
        raise ValueError('unproven_inventory_worker')
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--inspect', action='store_true')
    mode.add_argument('--inventory-worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if not args.inspect and not args.inventory_worker:
        print(json.dumps({**local_report(), 'mode': 'dry_run', 'httpRequests': 0})); return 0
    if args.inventory_worker:
        report = inspect(); print(json.dumps(report)); return 0 if report['managementIdentityConfirmed'] else 1
    allowed = {'PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'RENDER_API_KEY', 'SUPABASE_ACCESS_TOKEN'}
    parent_binding_presence = {name: bool(os.environ.get(name)) for name in ['RENDER_API_KEY', 'SUPABASE_ACCESS_TOKEN', NAME]}
    try:
        result = subprocess.run([sys.executable, __file__, '--inventory-worker'], env={k: v for k, v in os.environ.items() if k in allowed}, capture_output=True, text=True, timeout=32)
        if len(result.stdout) > MAX_BYTES:
            raise ValueError('inventory_worker_output_limit')
        report = validate_worker_report(json.loads(result.stdout), result.returncode)
        report['bindingNamesPresentLocally'] = parent_binding_presence
        print(json.dumps(report)); return result.returncode
    except Exception:
        print(json.dumps({'scope': 'read-only transition inventory', 'managementIdentityConfirmed': False, 'error': 'inventory_worker_failed_or_timed_out', 'requestsMaximum': 3, 'deploymentPerformed': False})); return 1


if __name__ == '__main__':
    raise SystemExit(main())
