"""Offline-only real HTTP bridge for the browser cold parallel-search test."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import threading

web = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('cold_fixture_gateway', web / 'server/live_gateway.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
day = dt.datetime.now(g.UTC).astimezone(g.ZoneInfo('Europe/Dublin')).date().isoformat()
base = {'version': 1, 'source': 'nta_gtfs', 'feedVersion': 'offline-cold-browser-fixture', 'loadedAt': day + 'T00:00:00Z', 'timezone': 'Europe/Dublin', 'scope': 'stop_to_stop_same_stop_transfers'}
a = {'id': 'A', 'name': 'Offline fixture Ballina', 'code': '555051', 'lat': 54.11, 'lon': -9.15}
b = {'id': 'B', 'name': 'Offline fixture Hospital', 'code': '15108', 'lat': 53.85, 'lon': -9.30}
barrier = threading.Barrier(2)

def loader(name, key, params):
    barrier.wait(timeout=3)  # The uncorrected per-peer worker guard breaks this.
    if name == 'stops':
        return {**base, 'validFrom': day, 'validUntil': day, 'stops': [a, b]}
    ride = {'tripId': 'offline-trip', 'route': 'Offline 420', 'mode': 'bus', 'destination': 'Offline Hospital', 'from': a, 'to': b, 'boardAt': 28800, 'alightAt': 30000, 'serviceDate': day}
    return {**base, 'serviceDate': day, 'walkingIncluded': False, 'realTimeApplied': False, 'predictionType': 'scheduled', 'minBoardingSeconds': 60, 'minTransferSeconds': 120,
            'journeys': [{'id': 'j-' + 'a' * 64, 'departureAt': 28800, 'arrivalAt': 30000, 'changes': 0, 'rides': [ride]}]}

handler = type('ColdFixtureHandler', (g.GatewayHandler,), {'schedules': g.ScheduleService(loader, key='offline-fixture'), 'request_times': []})
server = g.GatewayServer(('127.0.0.1', 0), handler)
print(json.dumps({'event': 'offline_gateway_ready', 'port': server.server_address[1], 'date': day}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
    handler.schedules.pool.shutdown(wait=False, cancel_futures=True)
