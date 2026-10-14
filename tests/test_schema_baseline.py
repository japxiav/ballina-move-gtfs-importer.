import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('schema_capture', ROOT/'scripts/capture_schema_baseline.py')
capture = importlib.util.module_from_spec(spec); spec.loader.exec_module(capture)

class SchemaBaseline(unittest.TestCase):
    def test_reviewed_baseline_regenerates_exactly_with_owners_acl_and_bigint_precision(self):
        directory = ROOT/'docs/schema-baseline-20261014'
        metadata = json.loads((directory/'metadata.json').read_text())
        sql = capture.baseline(metadata)
        self.assertEqual(sql, (directory/'schema.sql').read_text())
        manifest = json.loads((directory/'manifest.json').read_text())
        self.assertEqual(hashlib.sha256(sql.encode()).hexdigest(), manifest['schemaSha256'])
        for sequence in metadata['sequences']:
            self.assertEqual(sequence['max'], '9223372036854775807')
            self.assertIn('MAXVALUE '+sequence['max'], sql)
            self.assertIn('ALTER SEQUENCE public."'+sequence['name']+'" OWNER TO', sql)
        capture.safe(sql)

    def test_known_credential_literals_fail_before_any_export_without_echo(self):
        for value in ['eyJ'+'x'*24+'.'+'y'*24+'.'+'z'*24, 'sb_secret_'+'x'*32, "api_key='"+'x'*32+"'", 'Bearer '+'x'*32]:
            with self.assertRaisesRegex(ValueError, '^credential_literal_detected_export_refused$'): capture.safe(value)
        self.assertIn('statementsSha256', capture.QUERY)
        self.assertNotIn("'statements',statements", capture.QUERY)
        self.assertNotIn('vault.decrypted_secrets', capture.QUERY)

if __name__ == '__main__': unittest.main()
