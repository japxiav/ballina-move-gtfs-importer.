"""Required offline checks must be triggered by their cross-directory inputs."""
import fnmatch
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def event_paths(workflow, event):
    header = (ROOT / '.github/workflows' / workflow).read_text().split('\njobs:', 1)[0]
    block = re.search(r'\n  ' + event + r':\n(.*?)(?=\n  [a-z_]+:|\Z)', header, re.S)
    if not block:
        raise AssertionError(f'{workflow}: missing {event} trigger')
    return re.findall(r'^\s+- [\'\"]([^\'\"]+)[\'\"]', block.group(1), re.M)


class OfflineCiTriggers(unittest.TestCase):
    def assert_triggers(self, workflow, inputs):
        for event in ('push', 'pull_request'):
            patterns = event_paths(workflow, event)
            for path in inputs:
                with self.subTest(workflow=workflow, event=event, path=path):
                    self.assertTrue(any(fnmatch.fnmatchcase(path, glob) for glob in patterns),
                                    f'{path} would skip {workflow} on {event}')

    def test_a11_workflows_trigger_their_offline_routing_contracts(self):
        self.assert_triggers('routing-validation.yml', (
            '.github/workflows/a11-first-live-itinerary.yml',
            '.github/workflows/a11-live-walking-smoke.yml',
            '.github/workflows/a11-private-canary-readonly.yml',
        ))

    def test_gateway_compiler_manifests_trigger_importer_checks(self):
        self.assert_triggers('importer-validation.yml', (
            'routing/package.json', 'routing/package-lock.json',
        ))


if __name__ == '__main__':
    unittest.main()
