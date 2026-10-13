"""One approved Render source update, using existing reviewed API helpers.

Local operational orchestration only. No fabricated GitHub runner environment.
The workflow's bundled browser smoke lacks the approved tile/request bounds;
this launcher reuses its API/service/binding guards and runs bounded smoke
separately. No Edge/config/plan writes or automatic mutation retries.
"""
import argparse
import datetime as dt
import email.parser
import email.policy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
import urllib.request

REPO = Path('/workspace/ballina-move-gtfs-importer.')
OUT = Path('/workspace/.ballina-execution/product-mission/approved-preview')
SOURCE = '06b72b428fa623e7daf4d244b4851683506b78d0'
PREVIOUS = '3a96758b87d33908635f03d2e833cd5742609997'
SERVICE = 'srv-db6nhvrbc2fs739pb7mg'
OLD_DEPLOY = 'dep-db76rdc9v7es73alv28g'
PUBLIC = 'https://ballina-move-live.onrender.com/'
sys.path.insert(0, str(REPO / 'scripts'))
import deploy_live_gateway_render as api
from run_live_gateway_deployment import verified_service
from publisher_admission_binding import configured_value


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, text=True).strip()


def record(name, value):
    OUT.mkdir(exist_ok=True)
    (OUT / (name + '.json')).write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps(value), flush=True)


def supabase(path, raw=False):
    url = 'https://api.supabase.com/v1/projects/giwiqbnyozjbpmetrjhe' + path
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Accept': 'multipart/form-data' if raw else 'application/json'}, method='GET')
    with urllib.request.build_opener(api.NoRedirect()).open(req, timeout=15) as response:
        body = response.read(1048577)
        if len(body) > 1048576:
            raise ValueError('source_body_limit')
        return (response.headers.get('Content-Type', ''), body) if raw else json.loads(body)


def edge_state():
    functions = supabase('/functions')
    require(isinstance(functions, list), 'function_list_unproven')
    selected = {}
    for name, version in [('journey-api', 4), ('transport-api', 11)]:
        matches = [f for f in functions if f.get('slug', f.get('name')) == name]
        require(len(matches) == 1, 'function_identity_unproven')
        f = matches[0]
        require(f.get('version') == version and f.get('status') == 'ACTIVE', 'function_version_changed')
        if name == 'journey-api':
            require(f.get('verify_jwt') is False, 'function_jwt_changed')
        selected[name] = {'version': f['version'], 'status': f['status'], 'verify_jwt': f.get('verify_jwt')}
    kind, body = supabase('/functions/journey-api/body', raw=True)
    message = email.parser.BytesParser(policy=email.policy.default).parsebytes(('Content-Type: ' + kind + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
    require(message.is_multipart(), 'function_source_not_multipart')
    hashes = {}
    for part in message.iter_parts():
        filename = part.get_filename()
        if filename in ['functions/journey-api/index.ts', 'functions/transport-api/journeys.ts', 'supabase/functions/journey-api/index.ts', 'supabase/functions/transport-api/journeys.ts']:
            canonical = filename.removeprefix('supabase/')
            require(canonical not in hashes, 'duplicate_function_source')
            data = part.get_payload(decode=True)
            hashes[canonical] = hashlib.sha256(data).hexdigest()
            local = subprocess.check_output(['git', 'show', SOURCE + ':supabase/' + canonical], cwd=REPO)
            require(data == local, 'function_source_changed')
    require(len(hashes) == 2, 'function_source_files_unproven')
    return {'functions': selected, 'actualJourneySourceHashes': hashes}


def check():
    require(not git('status', '--porcelain'), 'dirty_source')
    require(not git('diff', SOURCE, '--', 'web', 'scripts', 'supabase', 'tests', 'routing', '.github'), 'candidate_application_changed')
    require(not git('diff', PREVIOUS, SOURCE, '--', 'web/server', 'supabase', 'scripts', '.github'), 'protected_backend_changed')
    require(git('ls-remote', 'origin', 'refs/heads/main').split()[0] == 'f38826625e08fe6bcd92073df45685fa36bbf7cf', 'main_changed')
    checks=json.loads(subprocess.check_output(['gh','api','repos/japxiav/ballina-move-gtfs-importer./commits/'+SOURCE+'/check-runs'],cwd=REPO,text=True))
    greens=[c for c in checks.get('check_runs',[]) if c.get('name')=='web-validation' and c.get('head_sha')==SOURCE and c.get('status')=='completed' and c.get('conclusion')=='success']
    require(bool(greens), 'exact_source_ci_unproven')
    references=[]
    for filename,blob,sha256 in [('render-client.go','d6cb95126ac6fb097ad9dc333f5ddf052fd5b0b1','0815f4d3b4cf71aa0bdbdf608a6fbe81a9155c21f30b76378d4244a25d62d380'),('render-types.go','265686dc9cc5775b9be6b54f2274ce181bde934d','5571c6f21f32918600bbecda9fa247291ca9a50e814542da1b730813a1dcd922')]:
        p=Path('/workspace/.ballina-execution/live-map')/filename
        require(hashlib.sha256(p.read_bytes()).hexdigest()==sha256, 'official_rollback_schema_changed')
        require(subprocess.check_output(['git','hash-object',str(p)],text=True).strip()==blob, 'official_rollback_blob_mismatch')
        references.append({'retainedPath':str(p),'sha256':sha256,'officialGithubBlob':blob})
    record('rollback-reference',{'source':'Official render-oss/cli pkg/client generated REST schema; retained file Git blob hashes matched fresh public GitHub contents metadata','references':references,'endpoint':'POST /services/{serviceId}/rollback','jsonBody':{'deployId':OLD_DEPLOY},'schemaExcerpt':'Trigger a rollback to a previous deploy of the specified service.','limits':'No rollback POST or rehearsal executed. Actual API does not expose a separate canRollback/eligibility flag; current successful image is serving and the documented rollback operation is available.','autoDeployRemainsOff':True})
    key = os.environ['RENDER_API_KEY']
    service = api.request('/services/' + SERVICE, key)
    require(verified_service(service, SERVICE) == PUBLIC and service.get('suspended')=='not_suspended', 'free_service_identity_changed')
    deployments = api.request('/services/' + SERVICE + '/deploys?limit=20', key)
    require(isinstance(deployments,list) and bool(deployments), 'deploy_history_unproven')
    records=[d.get('deploy',d) for d in deployments]
    require(not any(d.get('status') in {'created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress'} for d in records), 'another_deployment_pending')
    latest=records[0]
    require(latest.get('id') == OLD_DEPLOY and latest.get('status')=='live' and latest.get('commit', {}).get('id') == PREVIOUS, 'latest_live_source_changed')
    old = api.request('/services/' + SERVICE + '/deploys/' + OLD_DEPLOY, key)
    require(old.get('id') == OLD_DEPLOY and old.get('status') == 'live' and old.get('commit', {}).get('id') == PREVIOUS, 'previous_live_deployment_missing')
    edge = edge_state()
    # Existing canonical value stays only in this process; no file/export/copy.
    value = configured_value(key)
    require(len(value) == 64, 'canonical_binding_unproven')
    del value
    return {'observedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'candidateSource': SOURCE, 'previousSource': PREVIOUS, 'rollbackDeployment': OLD_DEPLOY, 'rollbackProtocol': 'POST /services/{serviceId}/rollback with deployId, documented in Render official generated CLI schema', 'currentRollbackImageAvailable': True, 'plan': 'free', 'autoDeploy': False, 'mainUnchanged': True, 'edge': edge, 'canonicalBindingConfirmedWithoutExposure': True, 'deploymentPerformed': False, 'paidCalls': 0, 'path': 'Existing reviewed API/service/canonical-binding helpers, local operational controller; not a GitHub Actions deployment'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    checked = check()
    record('preflight', checked)
    if not args.publish:
        return
    require(git('branch', '--show-current') == api.BRANCH, 'hosting_branch_unproven')
    require(git('rev-parse', 'HEAD') == SOURCE, 'source_pin_changed')
    require(git('ls-remote', 'origin', 'refs/heads/' + api.BRANCH).split()[0] == SOURCE, 'remote_source_pin_changed')
    require(not (OUT/'requested.json').exists(), 'already_requested_inspect_only')
    OUT.mkdir(exist_ok=True)
    # Exclusive durable intent prevents repeats after ambiguous request results.
    with (OUT/'publish-intent.json').open('x') as handle:
        handle.write(json.dumps({'sourceCommit':SOURCE,'serviceId':SERVICE,'createdAtUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'ownerApproved':True})+'\n')
    # Owner explicitly approved this exact source update and conditional rollback.
    # Only one mutation. Any ambiguous response must be inspected before retry.
    deployment = api.request('/services/' + SERVICE + '/deploys', os.environ['RENDER_API_KEY'], {'commitId': SOURCE})
    require(isinstance(deployment, dict) and isinstance(deployment.get('id'), str) and deployment['id'].startswith('dep-'), 'deployment_response_unproven')
    require(deployment.get('commit', {}).get('id') in (None, SOURCE), 'deployment_response_source_mismatch')
    record('requested', {'requestedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'serviceId': SERVICE, 'deploymentId': deployment['id'], 'sourceCommit': SOURCE, 'initialStatus': deployment.get('status'), 'plan': 'free', 'onlyMutation': 'POST existing service deploys with exact commitId', 'mainMerged': False, 'supabasePublished': False})


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        locations=[f.lineno for f in traceback.extract_tb(exc.__traceback__) if f.filename==__file__]
        record('operation-error', {'error': 'precondition_or_request_failed; inspect current provider state before retry', 'errorType': type(exc).__name__, 'controllerLines':locations,'privateValuesLogged': False})
        raise SystemExit(1)
