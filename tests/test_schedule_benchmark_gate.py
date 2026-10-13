import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('schedule_benchmark', Path(__file__).parents[1] / 'scripts/benchmark_scheduled_journeys.py')
benchmark = importlib.util.module_from_spec(spec); spec.loader.exec_module(benchmark)


class BenchmarkGate(unittest.TestCase):
    def summaries(self, cpu=8, rss=9, wall=7):
        return {name: {key: {'median': value} for key, value in zip(['cpuMs', 'peakRssMb', 'wallMs'], values)}
                for name, values in [('main', [9, 8, 9]), ('pr36', [10, 10, 10]), ('candidate', [cpu, rss, wall])]}

    def test_identical_journeys_do_not_hide_cpu_rss_or_latency_regression(self):
        for changes in [{'cpu': 11}, {'rss': 11}, {'wall': 11}]:
            self.assertFalse(benchmark.performance_gate(self.summaries(**changes), True)['passed'])
        self.assertFalse(benchmark.performance_gate(self.summaries(), False)['passed'])

    def test_main_memory_difference_is_explicit_and_not_an_a12_certification(self):
        result = benchmark.performance_gate(self.summaries(), True)
        self.assertTrue(result['passed']); self.assertFalse(result['mainComparisons']['rssNotAboveMain'])
        self.assertIn('not A12/host certification', result['scope'])
