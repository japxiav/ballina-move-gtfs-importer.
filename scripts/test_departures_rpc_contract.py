"""Offline active-SQL RPC -> gateway -> browser fixture integration.

Uses a pinned public Postgres image, disposable RAM-only container, no network,
no exposed port and no production records/credentials. Needs Docker. The SQL
snapshot was obtained read-only; scaffold retains actual column types only.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'web/tests/fixtures/departures-rpc'
IMAGE = 'postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
NOW = dt.datetime(2026, 10, 12, 20, 0, tzinfo=dt.timezone.utc)


def require(value, message):
    if not value:
        raise ValueError(message)


def sql(container, body):
    return subprocess.check_output(['docker', 'exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], input=body.encode(), timeout=20).decode().strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write-browser-fixture', action='store_true', help='Regenerate the checked synthetic fixture from actual SQL execution.')
    args = parser.parse_args()
    definition = (FIXTURE / 'get_stop_departures_v2.sql').read_bytes()
    provenance = json.loads((FIXTURE / 'provenance.json').read_text())
    require(hashlib.sha256(definition).hexdigest() == provenance['definitionSha256'], 'RPC source snapshot changed')
    container = 'ballina-offline-departures-' + uuid.uuid4().hex[:12]
    subprocess.run(['docker', 'run', '--rm', '-d', '--name', container, '--network', 'none', '--read-only', '--cpus', '1', '--memory', '384m', '--pids-limit', '128', '--security-opt', 'no-new-privileges', '--user', '70:70', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,noexec,size=128m,uid=70,gid=70,mode=0700', '--tmpfs', '/var/run/postgresql:rw,nosuid,noexec,size=8m,uid=70,gid=70,mode=0775', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE, 'postgres', '-c', 'shared_buffers=32MB', '-c', 'max_connections=10'], check=True, stdout=subprocess.DEVNULL)
    try:
        for _ in range(300):
            logs = subprocess.run(['docker', 'logs', container], capture_output=True, text=True, check=True)
            # The entrypoint briefly starts a temporary init server; its ready
            # socket must not be mistaken for the final server after restart.
            if 'PostgreSQL init process complete; ready for start up.' in logs.stdout + logs.stderr:
                ready = subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    break
            time.sleep(.1)
        else:
            raise ValueError('Offline Postgres did not become ready')
        sql(container, (FIXTURE / 'schema.sql').read_text() + '\n' + definition.decode())
        cases = [('cancel-fresh', 'CANCELED', None, -60), ('cancel-stale', 'CANCELED', None, -600), ('cancel-missing', 'CANCELED', None, -60), ('skip-fresh', None, 'SKIPPED', -60), ('skip-stale', None, 'SKIPPED', -600), ('no-data', None, 'NO_DATA', -60), ('no-realtime-stale', None, None, -1200), ('scheduled', None, None, -60), ('prediction-fresh', None, None, -60), ('prediction-stale', None, None, -600)]
        seed = """
INSERT INTO public.gtfs_feed_versions(version,label,active,imported_at) VALUES ('offline-rpc','nta-realtime',true,now());
INSERT INTO public.gtfs_calendars(version,service_id,start_date,end_date,monday) VALUES ('offline-rpc','fixture-service','2026-10-12','2026-10-12',true);
INSERT INTO public.gtfs_stops(version,stop_id,stop_name) VALUES ('offline-rpc','fixture-stop','Ballina SQL fixture');
INSERT INTO public.gtfs_routes(version,route_id,route_short_name) VALUES ('offline-rpc','fixture-route','Fixture route');
INSERT INTO public.regional_routes(route_id,route_name,operator_name,enabled) VALUES ('fixture-route','Fixture route','Fixture operator',true);
INSERT INTO public.collection_runs(channel,status,started_at) VALUES ('trip_update','ok',clock_timestamp());
"""
        for name, trip_relation, stop_relation, age in cases:
            observed = (NOW + dt.timedelta(seconds=age)).isoformat()
            tr = 'NULL' if trip_relation is None else "'" + trip_relation + "'"
            sr = 'NULL' if stop_relation is None else "'" + stop_relation + "'"
            prediction = "'2026-10-12T20:35:00Z'::timestamptz" if name.startswith('prediction') or name == 'no-realtime-stale' else 'NULL'
            seed += f"INSERT INTO public.gtfs_trips(version,trip_id,route_id,service_id,trip_headsign) VALUES ('offline-rpc','{name}','fixture-route','fixture-service','SQL fixture {name}');\n"
            seed += f"INSERT INTO public.gtfs_stop_times(version,trip_id,stop_id,stop_sequence,departure_seconds,pickup_type) VALUES ('offline-rpc','{name}','fixture-stop',1,77400,0);\n"
            seed += f"INSERT INTO public.stop_predictions(version,trip_id,stop_id,service_date,observed_at,source_timestamp,trip_schedule_relationship,schedule_relationship,predicted_departure) VALUES ('offline-rpc','{name}','fixture-stop','2026-10-12','{observed}','{observed}',{tr},{sr},{prediction});\n"
            if trip_relation and name != 'cancel-missing':
                seed += f"INSERT INTO public.service_observations(feed_version,trip_id,service_date,channel,mapping_status,schedule_relationship,observed_at,source_timestamp) VALUES ('offline-rpc','{name}','2026-10-12','trip_update','exact_trip','CANCELED','{observed}','{observed}');\n"
        sql(container, seed)
        raw = json.loads(sql(container, "SELECT json_agg(d) FROM public.get_stop_departures_v2(ARRAY['fixture-stop'],'2026-10-12T20:00:00Z',40) d;"))
        require(len(raw) == len(cases), 'SQL fixture departure count mismatch')
        spec = importlib.util.spec_from_file_location('offline_gateway', ROOT / 'web/server/live_gateway.py')
        gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)
        departures = gateway.parse_departures({'departures': raw}, NOW)
        by_trip = {d['tripId']: d for d in departures}
        expected = {'cancel-fresh': 'cancelled', 'cancel-stale': 'cancelled', 'cancel-missing': 'cancelled', 'skip-fresh': 'skipped', 'skip-stale': 'skipped', 'no-data': 'no_data', 'no-realtime-stale': 'no_data', 'scheduled': 'scheduled', 'prediction-fresh': 'predicted', 'prediction-stale': 'scheduled'}
        require({k: v['status'] for k, v in by_trip.items()} == expected, 'SQL to gateway enum or freshness mismatch')
        require(all(d['expectedAt'] is None and d['predictionObservedAt'] is None for d in departures if d['status'] != 'predicted'), 'Unsupported status became prediction')
        data = {'version': 2, 'mode': 'live', 'generatedAt': gateway.iso(NOW), 'collectorHealthy': True, 'sources': {k: {'status': 'empty' if k != 'departures' else 'ready', 'retrievedAt': gateway.iso(NOW)} for k in ['bus', 'rail', 'departures']}, 'vehicles': [], 'departures': departures}
        evidence = {'scope': 'Synthetic rows executed by actual captured active SQL, then production gateway; not live cancellations', 'definitionSha256': provenance['definitionSha256'], 'now': gateway.iso(NOW), 'sqlEnums': {r['trip_id']: r['service_status'] for r in raw}, 'gateway': data}
        target = FIXTURE / 'executed.json'
        if args.write_browser_fixture:
            target.write_text(json.dumps(evidence, indent=2) + '\n')
        else:
            require(json.loads(target.read_text()) == evidence, 'Checked browser replay differs from actual SQL/gateway output')
        print(json.dumps({'offlineSqlCases': len(cases), 'sqlGatewayMatched': True, 'browserFixtureMatched': True, 'network': 'none', 'publicPorts': 0, 'productionWrites': 0}))
    finally:
        subprocess.run(['docker', 'rm', '-f', container], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
