"""Negative controls for Stage 0 verifier, isolated from candidate sources."""
import importlib.util
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

PACKAGE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ballina_stage0',PACKAGE/'tools/run_stage0.py')
gate=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class Stage0VerifierNegativeTests(unittest.TestCase):
    def test_all_four_archives_and_inner_entries_match(self):
        data=gate.verify()
        self.assertEqual(len(data),4)
        self.assertTrue(all(x['matches_expected'] is True for x in data))
        self.assertTrue(all(x['entries']==x['verified_inner_entries'] for x in data))

    def test_changed_zip_comment_is_rejected_even_with_valid_crc(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            shutil.copytree(PACKAGE/'archives',root/'archives')
            (root/'docs').mkdir()
            shutil.copy2(PACKAGE/'docs/MANIFESTO_IMUTAVEL.json',root/'docs/MANIFESTO_IMUTAVEL.json')
            original_here,original_arch=gate.HERE,gate.ARCH
            try:
                gate.HERE=root;gate.ARCH=root/'archives'
                target=root/'archives'/gate.INDEPENDENT
                with zipfile.ZipFile(target,mode='a') as z:
                    z.comment=b'ADVERSARIAL COMMENT ONLY'
                with zipfile.ZipFile(target) as z:
                    self.assertIsNone(z.testzip())
                with self.assertRaisesRegex(RuntimeError,'Archive SHA-256 mismatch'):
                    gate.verify()
            finally:
                gate.HERE=original_here;gate.ARCH=original_arch

    def test_modified_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'docs').mkdir()
            shutil.copy2(PACKAGE/'docs/MANIFESTO_IMUTAVEL.json',root/'docs/MANIFESTO_IMUTAVEL.json')
            p=root/'docs/MANIFESTO_IMUTAVEL.json'
            p.write_bytes(p.read_bytes()+b' ')
            original_here=gate.HERE
            try:
                gate.HERE=root
                with self.assertRaisesRegex(RuntimeError,'manifest bytes changed'):
                    gate.verify()
            finally:
                gate.HERE=original_here

    def test_expected_red_diagnostics_are_accepted(self):
        log=(PACKAGE/'logs/expected_red_regressions.log').read_text()
        result=gate.check_tap({'output':log,'log':'fixture'},6,0,6,gate.EXPECTED)
        self.assertEqual(result,{'tests':6,'pass':0,'fail':6})

    def test_six_import_failures_are_not_accepted_as_expected_red(self):
        log=(PACKAGE/'logs/expected_red_regressions.log').read_text()
        log=log.replace("error: 'o provedor deve ser consultado para esta baldeacao'", "error: 'Cannot find module typescript'")
        with self.assertRaisesRegex(RuntimeError,'did not fail for the expected reason'):
            gate.check_tap({'output':log,'log':'fake_import_failure'},6,0,6,gate.EXPECTED)

    def test_wrong_assertion_operator_is_rejected(self):
        log=(PACKAGE/'logs/expected_red_regressions.log').read_text()
        log=log.replace("operator: 'notStrictEqual'", "operator: 'strictEqual'")
        with self.assertRaisesRegex(RuntimeError,'did not fail for the expected reason'):
            gate.check_tap({'output':log,'log':'fake_operator'},6,0,6,gate.EXPECTED)

    def test_duplicated_test_name_is_rejected(self):
        log=(PACKAGE/'logs/expected_red_regressions.log').read_text()
        log=log.replace('not ok 6 - A06:', 'not ok 6 - A05:')
        with self.assertRaisesRegex(RuntimeError,'unexpected or duplicate'):
            gate.check_tap({'output':log,'log':'duplicate'},6,0,6,gate.EXPECTED)

if __name__=='__main__':unittest.main()
