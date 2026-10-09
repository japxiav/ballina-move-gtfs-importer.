"""G0-04 negative tests: committed object != executed worktree.

Tests use only disposable repositories. They never contact GitHub and do not
modify the baseline source archives or the Ballina Move application.
"""
import importlib.util
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

GATE_FILE = pathlib.Path(__file__).resolve().parents[1] / 'ci/verify_full_github_main.py'


def load_gate():
    spec = importlib.util.spec_from_file_location('gate_g004', GATE_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class GateWorktreeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='bm-g004-negative-')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Gate Tests')
        self.git('config', 'user.email', 'gate@example.invalid')
        self.git('config', 'core.filemode', 'true')
        (self.root / 'import_gtfs.py').write_text('print("committed")\n')
        (self.root / '.gitignore').write_text('ignored.py\n__pycache__/\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture baseline')
        self.gate = load_gate()
        self.gate.COMMIT = self.git('rev-parse', 'HEAD')
        self.gate.EXPECTED_BLOBS = 2

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True).strip()

    def test_01_clean_worktree_accepted(self):
        data = self.gate.check(self.root)
        self.assertEqual(data['tree_entries'], 2)
        self.assertEqual(data['index_entries_verified'], 2)
        self.assertEqual(data['executed_worktree_files_verified'], 2)
        self.assertEqual(data['ignored_and_untracked_files_found'], 0)

    def test_02_g004_independent_proof_tracked_file_modified(self):
        before = self.gate.check(self.root)
        (self.root / 'import_gtfs.py').write_text('print("MODIFIED WORKTREE")\n')
        # Directly demonstrate old approach's blind spot: Git object is unchanged.
        self.assertEqual(before['commit'], self.git('rev-parse', 'HEAD'))
        self.assertEqual(self.git('show', 'HEAD:import_gtfs.py'), 'print("committed")')
        with self.assertRaisesRegex(RuntimeError, 'Executed worktree differs'):
            self.gate.check(self.root)

    def test_03_staged_file_modification_rejected(self):
        (self.root / 'import_gtfs.py').write_text('print("staged")\n')
        self.git('add', 'import_gtfs.py')
        with self.assertRaisesRegex(RuntimeError, 'index differs'):
            self.gate.check(self.root)

    def test_04_deleted_tracked_file_rejected(self):
        (self.root / 'import_gtfs.py').unlink()
        with self.assertRaisesRegex(RuntimeError, 'Missing tracked worktree files'):
            self.gate.check(self.root)

    def test_05_untracked_source_file_rejected(self):
        (self.root / 'shadow_module.py').write_text('SHADOW = True\n')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected worktree files'):
            self.gate.check(self.root)

    def test_06_ignored_python_file_rejected(self):
        (self.root / 'ignored.py').write_text('SHADOW = True\n')
        self.assertEqual(self.git('status', '--porcelain'), '')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected worktree files'):
            self.gate.check(self.root)

    def test_07_ignored_pyc_file_rejected(self):
        cache = self.root / '__pycache__'
        cache.mkdir()
        (cache / 'import_gtfs.cpython-313.pyc').write_bytes(b'fake bytecode')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected worktree files'):
            self.gate.check(self.root)

    def test_08_executable_permission_changed_rejected(self):
        target = self.root / 'import_gtfs.py'
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
        with self.assertRaisesRegex(RuntimeError, 'Executable bit mismatch'):
            self.gate.check(self.root)

    def test_09_replaced_regular_file_with_symlink_rejected(self):
        target = self.root / 'import_gtfs.py'
        target.unlink()
        target.symlink_to('.gitignore')
        with self.assertRaisesRegex(RuntimeError, 'Expected regular file'):
            self.gate.check(self.root)

    def test_10_committed_symlink_target_change_rejected(self):
        link = self.root / 'original_link'
        link.symlink_to('import_gtfs.py')
        self.git('add', 'original_link')
        self.git('commit', '-qm', 'Add tracked symlink')
        self.gate.COMMIT = self.git('rev-parse', 'HEAD')
        self.gate.EXPECTED_BLOBS = 3
        self.gate.check(self.root)
        link.unlink()
        link.symlink_to('.gitignore')
        with self.assertRaisesRegex(RuntimeError, 'Executed worktree differs'):
            self.gate.check(self.root)

    def test_11_modification_during_test_run_detected_afterward(self):
        before = self.gate.check(self.root)

        def malicious_test_fixture(_root):
            (self.root / 'import_gtfs.py').write_text('print("changed during test")\n')
            return {'exit': 0, 'log': 'mock test suite passed'}

        with patch.object(self.gate, 'run_importer_tests', side_effect=malicious_test_fixture):
            with patch.object(sys, 'argv', ['verify_full_github_main.py', '--checkout', str(self.root)]):
                with self.assertRaisesRegex(RuntimeError, 'Executed worktree differs'):
                    self.gate.main()
        self.assertEqual(before['tree_entries'], 2)

    def test_12_output_inside_checkout_is_rejected_before_execution(self):
        with patch.object(sys, 'argv', [
            'verify_full_github_main.py', '--checkout', str(self.root),
            '--metadata-only', '--output', str(self.root / 'results.json'),
        ]):
            with self.assertRaisesRegex(RuntimeError, 'Report output must be outside'):
                self.gate.main()
        self.assertFalse((self.root / 'results.json').exists())

    def test_13_restored_file_is_accepted(self):
        target = self.root / 'import_gtfs.py'
        original = target.read_bytes()
        target.write_bytes(b'modified')
        with self.assertRaisesRegex(RuntimeError, 'Executed worktree differs'):
            self.gate.check(self.root)
        target.write_bytes(original)
        self.gate.check(self.root)


if __name__ == '__main__':
    unittest.main()
