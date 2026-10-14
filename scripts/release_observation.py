"""One bounded, read-only preview observation. No cron, credentials or keepalive.

Default is a plan with zero HTTP calls; --once executes three fixed public reads.
This checks HTTP/data availability, never passenger readiness or browser rendering.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

HOST = 'https://ballina-move-live.onrender.com'
PATHS = ('/', '/api/stops', '/api/live')
MAX_BYTES = 1048576

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('redirect_refused')

def read_public(path, deadline):
    if path not in PATHS:
        raise ValueError('unapproved_observation_path')
    remaining = min(15, deadline - time.monotonic())
    if remaining <= 0:
        raise TimeoutError('observation_deadline')
    request = urllib.request.Request(HOST + path, headers={'User-Agent': 'BallinaMove/0.1 bounded read-only observation'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=remaining) as response:
        declared = response.headers.get('Content-Length')
        if declared is not None and (not declared.isdigit() or int(declared) > MAX_BYTES):
            raise ValueError('observation_body_too_large')
        body = bytearray()
        while True:
            remaining = min(15, deadline - time.monotonic())
            if remaining <= 0:
                raise TimeoutError('observation_deadline')
            socket = getattr(getattr(getattr(response, 'fp', None), 'raw', None), '_sock', None)
            if socket is not None:
                socket.settimeout(remaining)
            chunk = response.read1(min(16384, MAX_BYTES + 1 - len(body)))
            if time.monotonic() >= deadline:
                raise TimeoutError('observation_deadline')
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                raise ValueError('observation_body_too_large')
        return bytes(body)

def summarize(path, body, now):
    if len(body) > MAX_BYTES:
        raise ValueError('observation_body_too_large')
    if path == '/':
        valid = b'<!doctype html>' in body.lower() and b'id="root"' in body
        return {'available': valid, 'htmlSha256': hashlib.sha256(body).hexdigest(), 'browserVerified': False}
    data = json.loads(body.decode('utf-8', errors='strict'))
    if not isinstance(data, dict) or type(data.get('version')) is not int or data.get('version') not in ({1, 2} if path == '/api/live' else {1}):
        raise ValueError('invalid_observation_schema')
    if path == '/api/stops':
        if data.get('source') != 'nta_gtfs' or data.get('timezone') != 'Europe/Dublin' or data.get('scope') != 'stop_to_stop_same_stop_transfers' or not isinstance(data.get('stops'), list) or not 1 <= len(data['stops']) <= 1000 or not isinstance(data.get('feedVersion'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', data['feedVersion']):
            raise ValueError('invalid_catalog_observation')
        start, end = dt.date.fromisoformat(data['validFrom']), dt.date.fromisoformat(data['validUntil'])
        today = now.astimezone(ZoneInfo('Europe/Dublin')).date()
        return {'available': start <= today <= end, 'coveredStops': len(data['stops']), 'feedVersion': data['feedVersion'], 'feedValidToday': start <= today <= end}
    if path != '/api/live' or data.get('mode') != 'live' or type(data.get('collectorHealthy')) is not bool or not isinstance(data.get('sources'), dict) or not isinstance(data.get('vehicles'), list) or len(data['vehicles']) > 550:
        raise ValueError('invalid_live_observation')
    statuses = {}
    for name in ('bus', 'rail', 'departures'):
        source = data['sources'].get(name)
        if not isinstance(source, dict) or source.get('status') not in {'ready', 'empty', 'unavailable'}:
            raise ValueError('invalid_source_observation')
        statuses[name] = source['status']
    fresh = 0
    for vehicle in data['vehicles']:
        if not isinstance(vehicle, dict):
            raise ValueError('invalid_vehicle_observation')
        if vehicle.get('mode') == 'bus' and vehicle.get('quality') == 'gps_observation' and vehicle.get('source') == 'nta':
            stamp = vehicle.get('observedAt')
            if not isinstance(stamp, str):
                continue
            observed = dt.datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            if observed.tzinfo is not None and -15 <= (now - observed).total_seconds() <= 180:
                fresh += 1
    return {'available': data['collectorHealthy'] and all(s != 'unavailable' for s in statuses.values()),
            'sourceStatus': statuses, 'collectorHealthy': data['collectorHealthy'],
            'freshBusGpsCount': fresh if statuses['bus'] == 'ready' and data['collectorHealthy'] else 0,
            'railObservationTimeKnown': False}

def observe(fetcher=read_public, now=None, clock=None):
    if clock is None:
        clock = (lambda: now) if now is not None else (lambda: dt.datetime.now(dt.timezone.utc))
    started_at = clock()
    deadline = time.monotonic() + 45
    checks = []
    for path in PATHS:
        started = time.monotonic()
        try:
            body = fetcher(path, deadline)
            sampled_at = clock()
            summary = summarize(path, body, sampled_at)
            item = {'path': path, 'httpStatus': 200, 'sampledAt': sampled_at.isoformat(), **summary}
        except urllib.error.HTTPError as error:
            item = {'path': path, 'available': False, 'httpStatus': error.code, 'error': 'http_unavailable'}
            error.close()  # Never expose an upstream body or diagnostics.
        except Exception:
            item = {'path': path, 'available': False, 'error': 'observation_unavailable'}
        checks.append({**item, 'elapsedMs': round((time.monotonic() - started) * 1000, 2)})
    return {'version': 1, 'target': HOST, 'observedAt': started_at.isoformat(), 'scope': 'one_read_only_http_data_sample',
            'requestsMaximum': 3, 'credentialsUsed': False, 'browserVerified': False,
            'coldStartState': 'unknown', 'recurringMonitoringEnabled': False,
            'checks': checks, 'allChecksPassed': all(x['available'] for x in checks)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.once:
        print(json.dumps({'mode': 'dry_run', 'target': HOST, 'paths': PATHS, 'httpRequests': 0, 'recurringMonitoringEnabled': False}))
        return 0
    if not args.worker:
        # DNS resolution can block outside socket deadlines. Kill the whole
        # worker after 47 seconds, including resolver/body work. Never retry.
        try:
            result = subprocess.run([sys.executable, __file__, '--once', '--worker'],
                                    capture_output=True, text=True, timeout=47)
        except subprocess.TimeoutExpired:
            print(json.dumps({'version': 1, 'scope': 'one_read_only_http_data_sample',
                              'allChecksPassed': False, 'error': 'observation_watchdog_timeout',
                              'requestsMaximum': 3, 'recurringMonitoringEnabled': False}))
            return 1
        if result.returncode not in (0, 1) or not result.stdout:
            print(json.dumps({'allChecksPassed': False, 'error': 'observation_worker_failed'}))
            return 1
        print(result.stdout, end='')
        return result.returncode
    report = observe()
    print(json.dumps(report, indent=2))
    return 0 if report['allChecksPassed'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
