"""Controlled offline benchmark of main, frozen PR36 and a committed candidate.

Requires the official capture (not credentials); no live reads or paid calls.
Fresh serial processes, rotated order, complete reference/candidate equality.
"""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '22bf89cbbe5eb81ca40dee52410a4d11c99382d5'
REFERENCE = '138951b5156b0174cdd61d7491eec7f0c77d9c2f'


def performance_gate(summaries, equal):
    # PR36 has the corrected journeys and native IDs; main is also reported,
    # but its wrong selection/positional IDs are not an equivalent workload.
    current, reference, main = (summaries[k] for k in ('candidate', 'pr36', 'main'))
    checks = {'samePublicJourneys': equal,
              'cpuNotAbovePr36': current['cpuMs']['median'] <= reference['cpuMs']['median'],
              'wallNotAbovePr36': current['wallMs']['median'] <= reference['wallMs']['median'],
              'rssNotAbovePr36': current['peakRssMb']['median'] <= reference['peakRssMb']['median']}
    return {'scope': 'local equivalent corrected PR36; not A12/host certification',
            'checks': checks, 'passed': all(checks.values()),
            'mainComparisons': {'cpuNotAboveMain': current['cpuMs']['median'] <= main['cpuMs']['median'],
                                'rssNotAboveMain': current['peakRssMb']['median'] <= main['peakRssMb']['median']}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--candidate-ref', default='HEAD')
    parser.add_argument('--request-path', action='store_true', help='Also measure cold module initialization and the real local-date query validation on every version.')
    parser.add_argument('--repeats', type=int, default=9)
    args = parser.parse_args()
    if not 9 <= args.repeats <= 31 or args.out.exists():
        parser.error('Use 9..31 repeats and a new evidence output path.')
    raw = args.snapshot.read_bytes()
    if len(raw) > 32 * 1024 * 1024:
        parser.error('Snapshot exceeds the 32MiB offline input limit.')
    snapshot = json.loads(raw)
    candidate = subprocess.check_output(['git', 'rev-parse', '--verify', args.candidate_ref + '^{commit}'], cwd=ROOT, text=True).strip()
    versions = {'main': BASELINE, 'pr36': REFERENCE, 'candidate': candidate}
    hashes, samples = {}, []
    compiler = ROOT / 'routing/node_modules/.bin/tsc'
    with tempfile.TemporaryDirectory(prefix='ballina-schedule-benchmark-') as directory:
        directory = Path(directory)
        modules = {}
        for label, ref in versions.items():
            source = subprocess.check_output(['git', 'show', ref + ':supabase/functions/transport-api/journeys.ts'], cwd=ROOT)
            path = directory / label / 'journeys.ts'; path.parent.mkdir()
            path.write_bytes(source)
            subprocess.run([str(compiler), '--target', 'es2022', '--lib', 'es2022,dom,dom.iterable', '--strict', '--skipLibCheck', '--module', 'commonjs', str(path)], check=True, cwd=ROOT, capture_output=True)
            modules[label] = path.with_suffix('.js')
            hashes[label] = {'source': hashlib.sha256(source).hexdigest(), 'compiled': hashlib.sha256(modules[label].read_bytes()).hexdigest()}
        labels = list(versions)
        for repeat in range(args.repeats):
            order = labels[repeat % 3:] + labels[:repeat % 3]
            for label in order:
                output = subprocess.check_output(['node', str(ROOT / 'scripts/schedule_benchmark_worker.cjs'), str(modules[label]), str(args.snapshot.resolve()), 'request-path' if args.request_path else 'solve'], cwd=ROOT, text=True, timeout=30)
                samples.append({'version': label, 'repeat': repeat + 1, **json.loads(output)})
    reference = next(row['journeys'] for row in samples if row['version'] == 'pr36')
    equal = all(row['journeys'] == reference for row in samples if row['version'] in {'pr36', 'candidate'})
    summaries = {label: {metric: {'median': statistics.median(values), 'min': min(values), 'max': max(values)}
                   for metric in ('cpuMs', 'wallMs', 'peakRssMb')
                   for values in [[r[metric] for r in samples if r['version'] == label]]} for label in labels}
    gate = performance_gate(summaries, equal)
    report = {'measurement': 'cold_module_query_validation_solve' if args.request_path else 'solve', 'scope': 'offline captured official snapshot; fresh serial rotated processes; no warmup or provider calls; not hosted performance',
              'refs': versions, 'hashes': hashes, 'runtime': subprocess.check_output(['node', '--version'], text=True).strip(),
              'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'snapshotVersion': snapshot['version'],
              'snapshotRows': {k: len(v) for k, v in snapshot['tables'].items()},
              'candidateJourneysEqualPr36': equal, 'performanceGate': gate, 'summaries': summaries, 'samples': samples}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print(json.dumps({'candidateJourneysEqualPr36': equal, 'performanceGate': gate, 'summaries': summaries}))
    return 0 if gate['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
