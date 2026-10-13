"""Local prerequisite only; never proof of matching hosted secret bindings."""
import os
import hashlib
from pathlib import Path
import re

NAME = 'BALLINA_JOURNEY_GATEWAY_SECRET'
LEGACY_HASHES = {
    # Exact deployed gateway643bc52 and journey-api v2/main22bf89c sources.
    'gateway': frozenset({'8c1ca95564877b67962f9ea13ae7413d1d1e9e94024a4b4d3df83aabc0be0857'}),
    'edge': frozenset({'2b5b9d16ac9a51e511530021c761ba75ef32f643c64019651d43d68c086ba07a'}),
}


def requires_private_admission(root, target):
    source = {'gateway': 'web/server/live_gateway.py', 'edge': 'supabase/functions/journey-api/index.ts'}.get(target)
    if source is None:
        raise ValueError('Unknown publication target.')
    # Read the exact reviewed source, not a version label or an operator flag.
    raw = (Path(root) / source).read_bytes()
    if hashlib.sha256(raw).hexdigest() in LEGACY_HASHES[target]:
        return False
    if NAME not in raw.decode('utf-8', errors='strict'):
        raise ValueError('Unknown admission source contract; no publication attempted.')
    return True


def require_local_binding(root, target, binding=None):
    if not requires_private_admission(root, target):
        return False  # Retained older source has no private-admission contract.
    value = os.environ.get(NAME, '') if binding is None else binding
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('Reviewed source requires the configured server-only schedule binding; no publication attempted.')
    # This is deliberately not a deployment approval or remote verification.
    return True
