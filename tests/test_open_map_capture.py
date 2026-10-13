import importlib.util
from pathlib import Path
import sys
import unittest

scripts = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location('hospital_map', scripts / 'fetch_hospital_open_map.py')
capture = importlib.util.module_from_spec(spec); spec.loader.exec_module(capture)


class OpenMapCapture(unittest.TestCase):
    def test_offline_capture_whitelists_geometry_not_editors_or_private_metadata(self):
        raw = b'<osm><node id="1" lat="53.85194" lon="-9.30559" user="private-editor" uid="999"><tag k="entrance" v="yes"/><tag k="contact:email" v="never-forward"/></node><node id="2" lat="53.85184" lon="-9.30599"/><way id="10" user="private-editor"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way></osm>'
        result = capture.topology(raw)
        self.assertEqual(result['source']['kind'], 'offline_fixture')
        self.assertFalse(result['physicalAccessVerified'])
        self.assertNotIn('private-editor', str(result)); self.assertNotIn('never-forward', str(result))
        self.assertEqual(result['nodes'][0]['tags'], {'entrance': 'yes'})

    def test_entities_large_bodies_and_unexpected_schemas_fail_closed(self):
        for raw in [b'<!DOCTYPE osm><osm/>', b'<!ENTITY x "y"><osm/>', b'x' * (capture.MAX_BYTES + 1), b'<private/>']:
            with self.assertRaises(ValueError): capture.topology(raw)
        encoded = '<!DOCTYPE osm [<!ENTITY x "footway">]><osm><node id="1" lat="53.85" lon="-9.3"/><node id="2" lat="53.86" lon="-9.3"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="&x;"/></way></osm>'.encode('utf-16')
        with self.assertRaises(ValueError): capture.topology(encoded)
        with self.assertRaises(ValueError): capture.topology(b'<osm><node id="1" lat="NaN" lon="-9.3"/></osm>')
