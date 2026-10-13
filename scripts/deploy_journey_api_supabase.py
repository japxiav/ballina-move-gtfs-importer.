"""Publish only the isolated read-only function through the supported API route.
Proxy-backed secure bindings work without extracting a raw token for CLI validation.
Multipart names and metadata follow Supabase's official CLI source deployment.
"""
import hashlib
import json
import os
from pathlib import Path
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
    if not isinstance(functions, list) or any(f.get('slug', f.get('name')) == 'journey-api' for f in functions):
        raise ValueError('Isolated function already exists; inspect before modifying it.')
    body, content_type, hashes = package(root)
    response = request('/functions/deploy?slug=journey-api', key, body, content_type)
    if not isinstance(response, dict) or response.get('slug', response.get('name')) != 'journey-api' or response.get('verify_jwt') is not False:
        raise ValueError('Deployment response needs inspection; no automatic retry.')
    print(json.dumps({'function': 'journey-api', 'project': PROJECT, 'version': response.get('version'), 'status': response.get('status'), 'sourceCommit': sha, 'sourceFileHashes': hashes, 'privateCanaryChanged': False}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(str(error) if isinstance(error, ValueError) else 'Management transport failed; inspect function before retrying.')
        raise SystemExit(1)
