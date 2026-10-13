"""Read the one owner-authorized app binding from its canonical Render store.

No value is written to files, Actions outputs, process env, logs or browsers.
"""
import json
import os
from pathlib import Path
import re

import deploy_live_gateway_render as api
from run_live_gateway_deployment import verified_service
from schedule_admission_guard import NAME, require_local_binding, requires_private_admission

SERVICE = 'srv-db6nhvrbc2fs739pb7mg'
PUBLIC = 'https://ballina-move-live.onrender.com/'


def configured_value(key, reader=None):
    reader = api.request if reader is None else reader
    value = reader('/services/' + SERVICE + '/env-vars/' + NAME, key)
    if not isinstance(value, dict):
        raise ValueError('Publisher app binding unavailable.')
    record = value.get('envVar', value)
    if not isinstance(record, dict) or record.get('key') != NAME or not isinstance(record.get('value'), str) or not re.fullmatch(r'[a-f0-9]{64}', record['value']):
        raise ValueError('Publisher app binding unavailable.')
    return record['value']


def require_publisher_binding(root, key, reader=api.request):
    if not requires_private_admission(root, 'gateway'):
        return False
    local = os.environ.get(NAME, '')
    # Nonempty malformed values are rejected; no silent repair/fallback.
    if local or os.environ.get('BALLINA_LOAD_SCHEDULE_SECRET_FROM_RENDER') != '1':
        return require_local_binding(root, 'gateway')
    value = configured_value(key, reader)
    return require_local_binding(root, 'gateway', binding=value)


def main():
    # This is only a read-only configuration check, never a deploy endpoint.
    key = os.environ.get('RENDER_API_KEY', '')
    if not key:
        raise ValueError('Publisher management binding unavailable.')
    service = api.request('/services/' + SERVICE, key)
    if verified_service(service, SERVICE) != PUBLIC:
        raise ValueError('Unexpected publisher service.')
    value = configured_value(key)
    if not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('Publisher app binding unavailable.')
    print(json.dumps({'check': 'publisher_app_binding', 'confirmed': True, 'serviceId': SERVICE,
                      'canonicalStore': 'Render', 'bindingName': NAME, 'requestsMaximum': 2,
                      'valueExposed': False, 'githubSecretCopyCreated': False, 'deploymentAttempted': False,
                      'scope': 'configuration retrieval only; not active gateway/Edge agreement'}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'check': 'publisher_app_binding', 'confirmed': False, 'error': 'publisher_binding_unavailable',
                          'valueExposed': False, 'deploymentAttempted': False}))
        raise SystemExit(1)
