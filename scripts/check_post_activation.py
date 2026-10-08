#!/usr/bin/env python3
"""Independent post-activation acceptance gate. Stdlib only, no database writes."""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def parse_time(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace('Z', '+00:00'))


def validate_health(health: dict, expected_version: str = '', now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    if health.get('status') != 'ok':
        raise ValueError('health_not_ok')
    active = health.get('active_feed') or {}
    active_version = active.get('version')
    if not active_version or (expected_version and active_version != expected_version):
        raise ValueError('active_feed_mismatch')
    if active.get('schema_completeness') != 'complete_nta_feed':
        raise ValueError('active_feed_not_complete')
    collector = health.get('collector') or {}
    if not collector.get('healthy'):
        raise ValueError('collector_not_healthy')
    runs = collector.get('latest_runs') or []
    if len(runs) < 2 or {r.get('channel') for r in runs[:2]} != {'trip_update', 'vehicle'}:
        raise ValueError('realtime_channels_not_both_healthy')
    max_age = max(240, int(collector.get('heartbeat_limit_seconds') or 180) + 60)
    for run in runs[:2]:
        if run.get('status') != 'ok' or run.get('http_status') != 200:
            raise ValueError('realtime_run_failed')
        observed = run.get('completed_at') or run.get('started_at')
        if not observed or not (-60 <= (now - parse_time(observed)).total_seconds() <= max_age):
            raise ValueError('realtime_run_stale')
        metadata = run.get('metadata') or {}
        if metadata.get('active_feed_version') != active_version:
            raise ValueError('realtime_version_mismatch')
    return {'active_version': active_version, 'channels': sorted(r['channel'] for r in runs[:2]), 'max_age_seconds': max_age}


def validate_departures(result: dict) -> dict:
    if not isinstance(result.get('departures'), list):
        raise ValueError('departure_api_invalid_response')
    return {'departure_count': len(result['departures'])}


def check(base_url: str, key: str, expected: str) -> dict:
    base = base_url.rstrip('/') + '/functions/v1/transport-api'
    def get(action: str, **params: str) -> dict:
        url = base + '?' + urlencode({'action': action, **params})
        req = Request(url, headers={'apikey': key, 'Accept': 'application/json'})
        with urlopen(req, timeout=20) as response:
            data = json.loads(response.read().decode('utf-8'))
            if not isinstance(data, dict):
                raise ValueError('invalid_transport_api_payload')
            return data
    health = get('health')
    accepted = validate_health(health, expected)
    accepted.update(validate_departures(get('departures', limit='5')))
    accepted['status'] = 'post_activation_ok'
    return accepted


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--expected-version', default=os.environ.get('EXPECTED_VERSION', ''))
    p.add_argument('--retry-seconds', type=int, default=0)
    p.add_argument('--poll-interval', type=int, default=20)
    args = p.parse_args()
    deadline = time.monotonic() + max(0,args.retry_seconds)
    while True:
        try:
            result=check(os.environ['SUPABASE_URL'], os.environ['SUPABASE_PUBLISHABLE_KEY'], args.expected_version)
            print(json.dumps(result, sort_keys=True))
            return 0
        except Exception as error:
            if time.monotonic() >= deadline:
                raise SystemExit(f'post_activation_health_failed:{type(error).__name__}:{error}') from error
            print(f'health_gate_pending:{type(error).__name__}:{error}', flush=True)
            time.sleep(min(max(2,args.poll_interval),max(0,deadline-time.monotonic())))


if __name__ == '__main__':
    raise SystemExit(main())
