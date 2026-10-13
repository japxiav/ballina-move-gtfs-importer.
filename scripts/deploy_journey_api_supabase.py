"""Publish only the isolated read-only function through the supported API route.
Proxy-backed secure bindings work without extracting a raw token for CLI validation.
Multipart names and metadata follow Supabase's official CLI source deployment.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request
import uuid

PROJECT = 'giwiqbnyozjbpmetrjhe'
ROOT = 'https://api.supabase.com/v1/projects/' + PROJECT
FILES = ['supabase/functions/journey-api/index.ts', 'supabase/functions/transport-api/journeys.ts']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Management redirect forbidden.')


def request(path, key, body=None, content_type=None):
    if not isinstance(key, str) or not key or len(key) > 512 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise ValueError('Secure publication binding invalid.')
    headers = {'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}
    if content_type:
        headers['Content-Type'] = content_type
    try:
        with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(ROOT + path, data=body, headers=headers), timeout=60) as response:
            data = response.read(1048577)
    except urllib.error.HTTPError as error:
        raise ValueError('Management request HTTP ' + str(error.code) + '; no private response logged.') from None
    if len(data) > 1048576:
        raise ValueError('Management response too large.')
    return json.loads(data)


def package(root):
    boundary = 'ballina-' + uuid.uuid4().hex
    chunks = []
    meta = {'name': 'journey-api', 'verify_jwt': False, 'entrypoint_path': FILES[0], 'import_map_path': '', 'static_patterns': []}
    chunks.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n' + json.dumps(meta) + '\r\n').encode())
    hashes = {}
    for filename in FILES:
        content = (root / filename).read_bytes()
        if len(content) > 200000:
            raise ValueError('Source file exceeds reviewed size.')
        hashes[filename] = hashlib.sha256(content).hexdigest()
        chunks.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: application/typescript\r\n\r\n').encode() + content + b'\r\n')
    chunks.append(('--' + boundary + '--\r\n').encode())
    return b''.join(chunks), 'multipart/form-data; boundary=' + boundary, hashes


def main():
    root = Path(__file__).resolve().parents[1]
    key = os.environ.get('SUPABASE_ACCESS_TOKEN', '')
    if not key:
        raise ValueError('Secure publication binding missing.')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip():
        raise ValueError('Publish requires preserved clean source.')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    functions = request('/functions', key)
    if not isinstance(functions, list) or any(not isinstance(f, dict) or not isinstance(f.get('slug', f.get('name')), str) or not re.fullmatch(r'[a-z0-9_-]{1,100}', f.get('slug', f.get('name'))) for f in functions):
        raise ValueError('Function list did not establish absence safely.')
    existing = [f for f in functions if f.get('slug') == 'journey-api' or f.get('name') == 'journey-api']
    expected = os.environ.get('BALLINA_SUPABASE_EXPECTED_VERSION')
    if existing:
        if not expected or not re.fullmatch(r'[1-9]\d{0,5}', expected) or len(existing) != 1 or existing[0].get('slug', existing[0].get('name')) != 'journey-api' or type(existing[0].get('version')) is not int or existing[0]['version'] != int(expected) or existing[0].get('verify_jwt') is not False or existing[0].get('status') != 'ACTIVE':
            raise ValueError('Existing function differs from explicitly reviewed version; no update.')
    elif expected:
        raise ValueError('Reviewed existing function is missing; no recreation.')
    body, content_type, hashes = package(root)
    response = request('/functions/deploy?slug=journey-api', key, body, content_type)
    if not isinstance(response, dict) or response.get('slug', response.get('name')) != 'journey-api' or response.get('verify_jwt') is not False or (expected and response.get('version') != int(expected) + 1):
        raise ValueError('Deployment response needs inspection; no automatic retry.')
    print(json.dumps({'function': 'journey-api', 'project': PROJECT, 'version': response.get('version'), 'status': response.get('status'), 'sourceCommit': sha, 'sourceFileHashes': hashes, 'privateCanaryChanged': False}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print('Management deployment failed; inspect function before retrying. No credentials or private responses logged.')
        raise SystemExit(1)
