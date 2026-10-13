"""One genuine fixed private protocol request; binding arrives by anonymous pipe."""
import importlib.util
import json
from pathlib import Path
import re
import sys
import urllib.request

ROOT = Path('/workspace/ballina-move-gtfs-importer.')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Redirect refused.')


def main():
    binding = sys.stdin.buffer.read(65).decode('ascii')
    if not re.fullmatch(r'[a-f0-9]{64}', binding):
        raise ValueError('Invalid binding.')
    spec = importlib.util.spec_from_file_location('reviewed_gateway', ROOT / 'web/server/live_gateway.py')
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)
    assert g.JOURNEY_URL == 'https://giwiqbnyozjbpmetrjhe.supabase.co/functions/v1/journey-api'
    request = urllib.request.Request(g.JOURNEY_URL + '?action=admission',
        headers={'apikey': g.public_key(), 'X-Ballina-Gateway': binding, 'Accept': 'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=3) as response:
        if response.status != 200:
            raise ValueError('Unconfirmed admission.')
        raw = response.read(1025)
    if len(raw) > 1024:
        raise ValueError('Oversized response.')
    value = json.loads(raw.decode('utf-8', errors='strict'))
    expected = {'version': 1, 'source': 'journey-api', 'admission': 'gateway-secret-v1',
                'quotaConsumed': False, 'snapshotRead': False}
    if not isinstance(value, dict) or set(value) != set(expected) or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items()):
        raise ValueError('Unexpected protocol.')
    print(json.dumps({'check': 'operator_private_admission', 'confirmed': True,
                      'requestsMaximum': 1, 'quotaConsumed': False, 'snapshotRead': False,
                      'secretExported': False, 'hostedGatewayCliExecuted': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'check': 'operator_private_admission', 'confirmed': False,
                          'error': 'unconfirmed', 'secretExported': False,
                          'hostedGatewayCliExecuted': False}))
        raise SystemExit(1)
