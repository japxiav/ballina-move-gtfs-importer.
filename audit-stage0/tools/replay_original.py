#!/usr/bin/env python3
"""Offline reproducibility harness for Ballina Move audit. Read-only to sources/remotes.
Run from anywhere: python tools/replay.py --output-dir ./replay_results
Extracts archives into a fresh temporary workspace, keeping originals untouched.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent.parent
AR = HERE / "archives"
BASES = {
    "Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip": "94b52715e4842d73cdf9a48e23c75815bd3fccd4756bc4796e1f438ee1ffa7a2",
    "Ballina_Move_v0.9.9_UPLOAD_GITHUB_83_ARQUIVOS.zip": "f994fb99f556c62a4ee785fd32656c712f9d71ea7c95818668f5f656c6eb3ebd",
    "Ballina_Move_Auditoria_Integral_PARTE_2_2026-10-09.zip": "6e77f272f3aabdbdf73c6f2d7f299b30148b9a80f534d74776959586e26e7fc6",
}
EVIDENCE = "Ballina_Move_AUDITORIA_PROFUNDA_PROGRESSO_2026-10-09.zip"


def digest(path: Path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def integrity():
    data = []
    for filename, expected in BASES.items():
        p = AR / filename
        if not p.is_file():
            raise RuntimeError(f"Missing archive {filename}")
        observed = digest(p)
        with zipfile.ZipFile(p) as z:
            error = z.testzip()
            total = len(z.infolist())
        result = dict(filename=filename, expected=expected, observed=observed, hash_match=(expected==observed), entries=total, integrity=(error is None))
        data.append(result)
        if observed != expected or error is not None:
            raise RuntimeError(f"Archive integrity failure: {filename}")
    p = AR / EVIDENCE
    if not p.is_file():
        raise RuntimeError(f"Missing original evidence {EVIDENCE}")
    with zipfile.ZipFile(p) as z:
        if z.testzip():
            raise RuntimeError('Original evidence ZIP integrity failure')
        original = json.loads(z.read('evidence/BASELINES.json'))
        names = {x['filename']: x['sha256'] for x in original['archives']}
        if names != BASES:
            raise RuntimeError('Original BASELINES.json disagrees with verified archive manifest')
        evidence_count = len(z.infolist())
    return data, dict(filename=EVIDENCE, sha256=digest(p), entries=evidence_count)


def extract_safe(zip_path: Path, destination: Path):
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(zip_path) as z:
        for member in z.infolist():
            name = member.filename
            if not name or name.startswith(('/', '\\')) or '\\' in name or (':' in name.split('/')[0]):
                raise RuntimeError(f"Unsafe ZIP path {name}")
            target = (destination / name).resolve()
            if target != root and root not in target.parents:
                raise RuntimeError(f"ZIP path traversal {name}")
        z.extractall(destination)


def call(label: str, args: list[str], cwd: Path, logdir: Path, *, expected_exit=None, timeout=300):
    print(f"Running {label}...", flush=True)
    try:
        p = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        out = p.stdout
        rc = p.returncode
    except subprocess.TimeoutExpired as e:
        rc = 124
        out = ((e.stdout or b'').decode(errors='replace') if isinstance(e.stdout, bytes) else (e.stdout or '')) + '\nTIMEOUT'
    (logdir / (label + '.log')).write_text(f"CMD: {' '.join(args)}\nCWD: [temp-workspace]/{cwd.name}\nRC: {rc}\n\n" + out, encoding='utf8')
    if expected_exit is not None and rc not in expected_exit:
        raise RuntimeError(f"{label}: returned {rc}, expected one of {expected_exit}; see log")
    print(f"  {label}: exit={rc}", flush=True)
    return dict(label=label, exit_code=rc, log=label+'.log', output=out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify-only', action='store_true', help='Verify original ZIP files and hashes without running tests')
    ap.add_argument('--output-dir', default='replay_results', help='Save test output here')
    ns = ap.parse_args()
    manifest, evidence = integrity()
    print('ARCHIVES VERIFIED:', len(manifest), 'baseline ZIPs; original evidence ZIP has',evidence['entries'],'files')
    if ns.verify_only:
        print(json.dumps(dict(baselines=manifest, original_evidence=evidence), indent=2))
        return
    outdir = Path(ns.output_dir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    outputs = []
    with tempfile.TemporaryDirectory(prefix='ballina-audit-replay-') as temp:
        base = Path(temp)
        src = base / 'source'
        prev = base / 'previous'
        audit = base / 'original_evidence'
        extract_safe(AR/'Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip', src)
        src099 = base / 'source_v099_partial'
        extract_safe(AR/'Ballina_Move_v0.9.9_UPLOAD_GITHUB_83_ARQUIVOS.zip', src099)
        extract_safe(AR/'Ballina_Move_Auditoria_Integral_PARTE_2_2026-10-09.zip', prev)
        extract_safe(AR/EVIDENCE, audit)
        (base/'adversarial').mkdir()
        for p in (prev/'adversarial').iterdir():
            if p.is_file():
                shutil.copy2(p, base/'adversarial'/p.name)
        # Original reference_20000.cjs is unchanged in its ZIP. This is a portable
        # execution-only copy; it replaces its machine-specific output path.
        reference = base/'adversarial/reference_20000.cjs'
        orig = reference.read_text('utf8')
        hardcoded = '/mnt/data/ballina_audit_part2/adversarial/reference_counterexamples.json'
        if orig.count(hardcoded) != 1:
            raise RuntimeError('Reference script unexpected version; refusing to patch')
        portable = orig.replace(hardcoded, str((outdir/'reference_counterexamples.json').as_posix()))
        reference.write_text(portable, encoding='utf8')
        (outdir/'portability_change.txt').write_text('Only execution copy of adversarial/reference_20000.cjs changed:\n'+hardcoded+' -> '+str(outdir/'reference_counterexamples.json')+'\nOriginal script preserved unchanged in the previous-audit ZIP.\n')
        # XML corpus retains its exact original contents. It resolves the candidate
        # at ../baselines/candidate_v010, so extract the same hash-checked ZIP there.
        xml_dir = base/'tests'
        xml_dir.mkdir()
        shutil.copy2(audit/'tests/xml_conformance.cjs', xml_dir/'xml_conformance.cjs')
        candidate_at_xml = base/'baselines/candidate_v010'
        extract_safe(AR/'Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip', candidate_at_xml)
        node = shutil.which('node')
        tsc = shutil.which('tsc')
        if not node or not tsc:
            raise RuntimeError('Need node and TypeScript compiler tsc in PATH')
        outputs.append(call('tsc_build_v099_partial', [tsc,'-p','tsconfig.json'], src099/'routing', outdir, expected_exit={0}))
        oldtests = sorted(str(x) for x in (src099/'routing/tests').glob('*.test.cjs'))
        outputs.append(call('baseline_v099_partial_node_tests', [node,'--test',*oldtests], src099/'routing', outdir, expected_exit={0}))
        outputs.append(call('tsc_build', [tsc,'-p','tsconfig.json'], src/'routing', outdir, expected_exit={0}))
        tests=sorted(str(x) for x in (src/'routing/tests').glob('*.test.cjs'))
        outputs.append(call('baseline_node_tests', [node,'--test',*tests], src/'routing', outdir, expected_exit={0}))
        # XML corpus reads a second extraction of the same candidate ZIP; it needs
        # the compiled dist generated from the candidate sources above.
        shutil.copytree(src/'routing/dist', candidate_at_xml/'routing/dist', dirs_exist_ok=True)
        outputs.append(call('artifact_parity', [node,'scripts/verify_singlefile_parity_010.cjs'], src/'routing', outdir, expected_exit={0}))
        outputs.append(call('sealed_staging', [node,'--test','staging/tests/sealed_gate.test.cjs'], src, outdir, expected_exit={0}))
        outputs.append(call('adversarial_replay', [node,'--test','adversarial/parte2_regressions.test.cjs'], base, outdir, expected_exit={1}))
        outputs.append(call('xml_corpus', [node,'tests/xml_conformance.cjs'], base, outdir, expected_exit={0}))
        outputs.append(call('reference_20000', [node,'adversarial/reference_20000.cjs'], base, outdir, expected_exit={0}, timeout=300))
    errors=[]
    text = {x['label']:x['output'] for x in outputs}
    testsout=text['baseline_node_tests']
    if not (re.search(r'# tests\s+245\b', testsout) and re.search(r'# pass\s+245\b', testsout) and re.search(r'# fail\s+0\b', testsout)):
        errors.append('Baseline Node suite does not report 245 pass / 0 fail')
    oldtestsout=text['baseline_v099_partial_node_tests']
    if not (re.search(r'# tests\s+204\b', oldtestsout) and re.search(r'# pass\s+204\b', oldtestsout) and re.search(r'# fail\s+0\b', oldtestsout)):
        errors.append('v0.9.9 partial Node suite does not report 204 pass / 0 fail')
    adv=text['adversarial_replay']
    if not (re.search(r'# tests\s+8\b',adv) and re.search(r'# pass\s+3\b',adv) and re.search(r'# fail\s+5\b',adv)):
        errors.append('Adversarial suite does not report 8 tests / 3 pass / 5 fail')
    sg=text['sealed_staging']
    if not (re.search(r'# tests\s+6\b',sg) and re.search(r'# pass\s+6\b',sg)):
        errors.append('Sealed gate does not report 6/6')
    try:
        comparator=json.loads(text['reference_20000'][text['reference_20000'].find('{'):])
        if comparator.get('cases') != 20000 or comparator.get('eligible') != 19283 or comparator.get('discrepancies') != []:
            errors.append('Comparator did not report expected 20000 / 19283 / []')
    except Exception:
        errors.append('Comparator output not parseable')
    report = dict(archive_manifest=manifest, original_evidence=evidence,
                  executed=[{k:v for k,v in entry.items() if k!='output'} for entry in outputs],
                  expectations_satisfied=not errors, errors=errors,
                  isolation='original ZIP files not modified; all source files extracted to temporary directories',
                  environment=dict(node=subprocess.run([node,'--version'],capture_output=True,text=True).stdout.strip(),
                                   tsc=subprocess.run([tsc,'--version'],capture_output=True,text=True).stdout.strip(),
                                   python=sys.version.split()[0]))
    (outdir/'RESULTS.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    print('RESULT:', 'PASS' if not errors else 'CHECK LOGS: '+ '; '.join(errors))
    if errors:
        raise SystemExit(1)

if __name__=='__main__':
    main()
