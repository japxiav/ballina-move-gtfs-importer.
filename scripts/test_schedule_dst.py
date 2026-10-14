"""Offline schedule instant oracle using Python's independent IANA zoneinfo.

The TypeScript engine uses Intl round trips; this oracle uses service-date noon
in zoneinfo minus twelve elapsed hours, as required by GTFS and the active RPC.
No network, production rows, credentials or wall-clock test dependencies.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ZONE = ZoneInfo('Europe/Dublin')
UTC = dt.timezone.utc
NODE = """const fs=require('node:fs'); const {searchScheduledJourneys}=require('/tmp/ballina-ts-compiled/ballina_journeys.js');
(async()=>{const cases=JSON.parse(fs.readFileSync(0,'utf8'));const out=[];for(const c of cases){try{out.push({result:await searchScheduledJourneys(c.snapshot,c.query)});}catch(e){out.push({error:e.message});}}process.stdout.write(JSON.stringify(out));})();"""

def instant(date, time='00:00'):
    return dt.datetime.fromisoformat(f'{date}T{time}').replace(tzinfo=ZONE).astimezone(UTC)

def case(service_date, query_date=None, time='07:55', board=28800, alight=31920):
    query_date = query_date or service_date
    stop = lambda name: {'stop_id': name, 'stop_name': 'Offline DST ' + name, 'stop_code': name, 'stop_lat': 54.1, 'stop_lon': -9.1}
    rows = [{'trip_id': 'dst-trip', 'stop_id': name, 'stop_sequence': seq, 'arrival_seconds': seconds, 'departure_seconds': seconds, 'pickup_type': 0, 'drop_off_type': 0} for seq, name, seconds in [(1, 'A', board), (2, 'B', alight)]]
    snapshot = {'version': 'offline-dst', 'start': '2026-01-01', 'end': '2026-12-31', 'loadedAt': '2026-10-14T00:00:00Z', 'tables': {'stops': [stop('A'), stop('B')], 'routes': [{'route_id': 'dst-route', 'route_short_name': 'Fixture DST', 'route_type': 3}], 'trips': [{'trip_id': 'dst-trip', 'route_id': 'dst-route', 'service_id': 'S'}], 'times': rows, 'calendars': [], 'exceptions': [{'service_id': 'S', 'service_date': service_date, 'exception_type': 1}]}}
    return {'snapshot': snapshot, 'query': {'from': 'A', 'to': 'B', 'date': query_date, 'time': time, 'modes': 'bus', 'changes': '0'}, 'board': board, 'alight': alight, 'serviceDate': service_date}

def transfer_case(date, first_board, first_alight, second_board, final_alight):
    c = case(date, time='00:55', board=first_board, alight=first_alight)
    c['alight'] = final_alight; c['wait'] = second_board - first_alight
    c['query'].update(to='C', changes='1')
    tables = c['snapshot']['tables']
    tables['stops'].append({**tables['stops'][1], 'stop_id': 'C', 'stop_name': 'Offline DST C', 'stop_code': 'C'})
    tables['trips'].append({'trip_id': 'dst-transfer', 'route_id': 'dst-route', 'service_id': 'S'})
    tables['times'] += [{'trip_id': 'dst-transfer', 'stop_id': name, 'stop_sequence': seq, 'arrival_seconds': seconds, 'departure_seconds': seconds, 'pickup_type': 0, 'drop_off_type': 0} for seq, name, seconds in [(1, 'B', second_board), (2, 'C', final_alight)]]
    return c

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--write-fixture', action='store_true'); args = parser.parse_args()
    cases = [case(f'2026-{month:02d}-{day:02d}') for month, days in [(3, range(27, 32)), (10, range(23, 28))] for day in days]
    cases += [case('2026-03-28', '2026-03-29', time='03:55', board=28*3600, alight=29*3600), case('2026-10-24', '2026-10-25', time='02:55', board=28*3600, alight=29*3600), case('2026-03-29', time='23:55', board=25*3600, alight=26*3600), case('2026-10-25', time='23:55', board=25*3600, alight=26*3600)]
    cases += [transfer_case('2026-10-25', 0, 300, 3720, 4320), transfer_case('2026-03-29', 7200, 7300, 7420, 7800)]
    cases += [case('2026-03-27', '2026-03-30', time='00:50', board=72*3600-1, alight=72*3600)]
    cross_day = transfer_case('2026-03-29', 25*3600, 25*3600+300, 7620, 7800)
    cross_day.update(serviceDate='2026-03-28', alight=25*3600+600, wait=120)
    cross_day['snapshot']['tables']['trips'][1]['service_id'] = 'S2'
    cross_day['snapshot']['tables']['exceptions'] = [{'service_id': 'S', 'service_date': '2026-03-28', 'exception_type': 1}, {'service_id': 'S2', 'service_date': '2026-03-29', 'exception_type': 1}]
    cases += [cross_day]
    cases += [case('2026-03-29', time='01:30'), case('2026-10-25', time='01:30')]
    env = {'PATH': os.environ['PATH']}
    results = json.loads(subprocess.check_output(['node', '-e', NODE], input=json.dumps(cases).encode(), env=env, timeout=30))
    for index, (c, response) in enumerate(zip(cases, results, strict=True)):
        if index >= len(cases)-2:
            assert response == {'error': 'clock_change_unsupported'}, response
            continue
        result = response['result']; reference = instant(c['query']['date'])
        assert dt.datetime.fromisoformat(result['referenceAt'].replace('Z', '+00:00')) == reference
        assert result['version'] == 2 and len(result['journeys']) == 1, (c, result)
        journey = result['journeys'][0]
        origin = instant(c['serviceDate'], '12:00') - dt.timedelta(hours=12)
        assert reference + dt.timedelta(seconds=journey['departureAt']) == origin + dt.timedelta(seconds=c['board'])
        assert reference + dt.timedelta(seconds=journey['arrivalAt']) == origin + dt.timedelta(seconds=c['alight'])
        assert journey['arrivalAt']-journey['departureAt'] == c['alight']-c['board']
        assert journey['rides'][0]['serviceDate'] == c['serviceDate']
        if 'wait' in c:
            assert journey['changes'] == 1
            assert journey['rides'][1]['boardAt'] - journey['rides'][0]['alightAt'] == c['wait']
    fixture = {'provenance': 'Synthetic offline DST scenarios; independent Python zoneinfo oracle, not real services.', 'cases': [{'query': c['query'], **r} for c, r in zip(cases, results, strict=True)]}
    target = ROOT / 'web/tests/fixtures/schedule-dst.json'
    if args.write_fixture: target.write_text(json.dumps(fixture, indent=2) + '\n')
    else: assert json.loads(target.read_text()) == fixture, 'DST fixture changed; regenerate explicitly and review'
    print(json.dumps({'dstCases': len(cases), 'ianaZoneinfoMatched': True, 'productionReads': 0, 'productionWrites': 0}))

if __name__ == '__main__': main()
