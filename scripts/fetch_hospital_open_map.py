"""Fixed-area, manual OpenStreetMap capture; default zero requests, no routing API.

Whitelist topology/tags only: never retain OSM usernames, editor IDs or history.
Open-data topology does not verify crossings, entrances or accessibility.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import re
from pathlib import Path
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from release_observation import NoRedirect

URL = 'https://api.openstreetmap.org/api/0.6/map?bbox=-9.309,53.849,-9.302,53.855'
MAX_BYTES = 2097152
TAGS = {'highway', 'foot', 'footway', 'access', 'access:conditional', 'foot:conditional', 'surface', 'crossing', 'crossing:signals', 'tactile_paving', 'wheelchair', 'entrance', 'barrier', 'amenity', 'healthcare', 'building', 'bridge', 'tunnel', 'layer', 'level', 'oneway', 'oneway:conditional', 'oneway:foot', 'oneway:foot:conditional', 'foot:forward', 'foot:backward'}


def topology(raw, live=False):
    if len(raw) > MAX_BYTES:
        raise ValueError('invalid_open_map_body')
    text = raw.decode('utf-8', errors='strict')
    if '\x00' in text or '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('invalid_open_map_body')
    tree = ET.fromstring(text)
    if tree.tag != 'osm': raise ValueError('invalid_open_map_schema')
    nodes, ways, references, node_ids, way_ids = [], [], 0, set(), set()
    def tags(element):
        result = {}
        for tag in element.findall('tag'):
            key, value = tag.get('k'), tag.get('v')
            if key not in TAGS: continue
            if key in result or not isinstance(value, str) or len(value) > 120: raise ValueError('invalid_open_map_tags')
            result[key] = value
        return result
    for node in tree.findall('node'):
        try:
            key, lat, lon = node.attrib['id'], float(node.attrib['lat']), float(node.attrib['lon'])
        except (KeyError, ValueError): raise ValueError('invalid_open_map_node') from None
        if not re.fullmatch(r'[1-9]\d{0,15}', key) or key in node_ids or not math.isfinite(lat) or not math.isfinite(lon) or not 51 <= lat <= 55.7 or not -11 <= lon <= -5:
            raise ValueError('invalid_open_map_node')
        node_ids.add(key)
        if len(node_ids) > 5000: raise ValueError('open_map_capacity')
        nodes.append({'id': key, 'lat': lat, 'lon': lon, 'tags': tags(node)})
    for way in tree.findall('way'):
        refs = [n.attrib['ref'] for n in way.findall('nd')]; references += len(refs)
        key = way.attrib['id']
        if references > 15000 or len(ways) >= 3000: raise ValueError('open_map_capacity')
        if not re.fullmatch(r'[1-9]\d{0,15}', key) or key in way_ids or len(refs) < 2 or any(r not in node_ids for r in refs): raise ValueError('invalid_open_map_way')
        way_ids.add(key); ways.append({'id': key, 'nodes': refs, 'tags': tags(way)})
    if len(nodes) > 5000 or len(ways) > 3000 or references > 15000:
        raise ValueError('open_map_capacity')
    return {'source': {'kind': 'osm_open_data' if live else 'offline_fixture', 'licence': 'ODbL-1.0' if live else 'fixture',
                       'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'rawSha256': hashlib.sha256(raw).hexdigest()},
            'nodes': nodes, 'ways': ways, 'physicalAccessVerified': False,
            'relationsNotResolved': len(tree.findall('relation')),
            'sourceUrl': URL if live else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--offline-file', type=Path)
    args = parser.parse_args()
    if args.once and args.offline_file: parser.error('Choose offline or one public capture.')
    if args.offline_file:
        try:
            print(json.dumps(topology(args.offline_file.read_bytes()), indent=2, allow_nan=False)); return 0
        except Exception:
            print(json.dumps({'available': False, 'error': 'invalid_offline_open_map'})); return 1
    if not args.once:
        print(json.dumps({'mode': 'dry_run', 'url': URL, 'requests': 0, 'paidRoutingCalls': 0})); return 0
    if not args.worker:
        try:
            result = subprocess.run([sys.executable, __file__, '--once', '--worker'], capture_output=True, text=True, timeout=17)
        except subprocess.TimeoutExpired:
            print(json.dumps({'available': False, 'error': 'open_map_deadline', 'requestsMaximum': 1})); return 1
        if result.returncode not in (0, 1) or not result.stdout:
            print(json.dumps({'available': False, 'error': 'open_map_unavailable'})); return 1
        print(result.stdout, end=''); return result.returncode
    try:
        request = urllib.request.Request(URL, headers={'User-Agent': 'BallinaMovePilotAudit/0.1 https://github.com/japxiav/ballina-move-gtfs-importer.'})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            raw = response.read(MAX_BYTES + 1)
        print(json.dumps(topology(raw, live=True), indent=2)); return 0
    except Exception:
        print(json.dumps({'available': False, 'error': 'open_map_unavailable', 'requestsMaximum': 1, 'paidRoutingCalls': 0})); return 1


if __name__ == '__main__': raise SystemExit(main())
