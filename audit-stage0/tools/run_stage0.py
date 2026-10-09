#!/usr/bin/env python3
"""Ballina Move STAGE 0 offline acceptance. No external writes or production changes.

Uses archived source ZIPs only. Every execution extracts into a fresh temporary dir.
Exit status 0 means baseline reproduced INCLUDING SIX EXPECTED RED REGRESSIONS;
exit status nonzero means stage0 evidence failed. Does NOT imply release approval.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time, zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent.parent
ARCH=HERE/'archives'
ORIGINALS={
    'Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip':'94b52715e4842d73cdf9a48e23c75815bd3fccd4756bc4796e1f438ee1ffa7a2',
    'Ballina_Move_v0.9.9_UPLOAD_GITHUB_83_ARQUIVOS.zip':'f994fb99f556c62a4ee785fd32656c712f9d71ea7c95818668f5f656c6eb3ebd',
    'Ballina_Move_Auditoria_Integral_PARTE_2_2026-10-09.zip':'6e77f272f3aabdbdf73c6f2d7f299b30148b9a80f534d74776959586e26e7fc6',
}
INDEPENDENT='Ballina_Move_META_AUDITORIA_EVIDENCIAS_INDEPENDENTES_2026-10-09.zip'
# Pin the original, independently reviewed Stage 0 manifest to avoid an accidental
# rewrite of an archive checksum AND the manifest in the same edit. This is NOT a
# cryptographic signature or externally attested provenance.
PINNED_STAGE0_MANIFEST_SHA256='e3aed949beed20801a11158639bb59265f652e1a4efeeb7ade02221770056911'
EXPECTED=['A01','A02','A03','A04','A05','A06']
def sha(path):
    d=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(65536),b''):d.update(b)
    return d.hexdigest()
def verify():
    """Check exact ZIP bytes AND exact uncompressed entries against immutable manifest.

    A CRC check only ensures internal ZIP checksums agree with ZIP contents. It
    cannot establish that the archive matches the baseline originally audited.
    """
    manifest_path=HERE/'docs/MANIFESTO_IMUTAVEL.json'
    if sha(manifest_path)!=PINNED_STAGE0_MANIFEST_SHA256:
        raise RuntimeError('Stage 0 manifest bytes changed; not the reviewed manifest')
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    listing=manifest.get('archives')
    if not isinstance(listing,dict):raise RuntimeError('Manifest lacks archive inventory')
    names=[*ORIGINALS,INDEPENDENT]
    if set(listing)!=set(names):raise RuntimeError('Manifest archive list is not exact')
    reports=[]
    for name in names:
        source=ARCH/name
        entry=listing[name]
        if not source.is_file():raise RuntimeError(f'Missing immutable archive: {name}')
        expected_archive=entry.get('sha256')
        if name in ORIGINALS and expected_archive!=ORIGINALS[name]:
            raise RuntimeError(f'Manifest disagreement with pinned baseline: {name}')
        actual_archive=sha(source)
        if actual_archive!=expected_archive:
            raise RuntimeError(f'Archive SHA-256 mismatch: {name}')
        with zipfile.ZipFile(source) as z:
            infos=z.infolist()
            filenames=[x.filename for x in infos]
            if len(filenames)!=len(set(filenames)):
                raise RuntimeError(f'Duplicate ZIP entry: {name}')
            if z.testzip():raise RuntimeError(f'Corrupt archive CRC: {name}')
            expected_files=entry.get('files')
            if not isinstance(expected_files,dict):
                raise RuntimeError(f'Missing per-entry manifest: {name}')
            if (len(infos)!=entry.get('file_count') or
                set(filenames)!=set(expected_files)):
                raise RuntimeError(f'Archive entry inventory mismatch: {name}')
            for info in infos:
                rel=Path(info.filename)
                if (rel.is_absolute() or '..' in rel.parts or
                    ((info.external_attr>>16)&0o170000)==0o120000):
                    raise RuntimeError(f'Unsafe ZIP member: {name}/{info.filename}')
                expected=expected_files[info.filename]
                if info.file_size!=expected['bytes']:
                    raise RuntimeError(f'Entry size mismatch: {name}/{info.filename}')
                with z.open(info) as fh:
                    digest=hashlib.sha256()
                    for block in iter(lambda:fh.read(65536),b''):digest.update(block)
                if digest.hexdigest()!=expected['sha256']:
                    raise RuntimeError(f'Entry hash mismatch: {name}/{info.filename}')
        reports.append({'file':name,'sha256':actual_archive,
                        'entries':len(infos),'matches_expected':True,
                        'verified_inner_entries':len(infos)})
    return reports

def safe_extract(src,dst):
    dst.mkdir(parents=True,exist_ok=True)
    root=dst.resolve()
    with zipfile.ZipFile(src) as z:
        for i in z.infolist():
            target=(dst/i.filename).resolve()
            if target!=root and root not in target.parents:raise RuntimeError(f'Unsafe ZIP path: {i.filename}')
            if ((i.external_attr>>16) & 0o170000)==0o120000:raise RuntimeError('Symlink entry forbidden')
        z.extractall(dst)

def run(cmd,cwd,out,env,timeout=150):
    started=time.perf_counter()
    try:
        p=subprocess.run(cmd,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,errors='replace',timeout=timeout)
        rc=p.returncode;stream=p.stdout
    except subprocess.TimeoutExpired as e:
        rc=124;stream=(e.stdout or b'').decode(errors='replace') if isinstance(e.stdout,bytes) else (e.stdout or '')
        stream+='\nTIMEOUT'
    elapsed=round(time.perf_counter()-started,5)
    out.write_text(f'$ {" ".join(cmd)}\nexit={rc} elapsed_wall_s={elapsed}\n\n{stream}',encoding='utf-8')
    return {'exit':rc,'elapsed_wall_s':elapsed,'output':stream,'log':out.name}

# Fixed, reviewable failure fingerprints from the frozen candidate. This catches
# environmental/import failures falsely counted as six red regression successes.
EXPECTED_RED_DIAGNOSTICS={
    'A01':('o provedor deve ser consultado para esta baldeacao',"operator: '=='"),
    'A02':('0 !== 1',"operator: 'strictEqual'"),
    'A03':('reader continuou pendente apos req.signal abort',"operator: 'strictEqual'"),
    'A04':('Missing expected exception.',"operator: 'throws'"),
    'A05':('Missing expected exception.',"operator: 'throws'"),
    'A06':('ferry foi reclassificada silenciosamente como bus',"operator: 'notStrictEqual'"),
}

def check_tap(report,total,passed,failed,names=None):
    s=report['output']
    matches={field:int(re.search(rf'^# {field}\s+(\d+)\s*$',s,re.M).group(1)) if re.search(rf'^# {field}\s+(\d+)\s*$',s,re.M) else None for field in ('tests','pass','fail')}
    if matches != {'tests':total,'pass':passed,'fail':failed}:
        raise RuntimeError(f'{report["log"]}: TAP counts {matches}, expected {(total,passed,failed)}')
    if names:
        blocks=re.findall(r'(?ms)^not ok\s+\d+\s+-\s+([^\n]+)\n(.*?)(?=^# Subtest:|^1\.\.\d+|\Z)',s)
        if len(blocks)!=len(names):
            raise RuntimeError(f'{report["log"]}: {len(blocks)} failure blocks vs {len(names)} required')
        seen=set()
        for title,details in blocks:
            label=title.split(':',1)[0]
            if label in seen or label not in names or not title.startswith(label+':'):
                raise RuntimeError(f'{report["log"]}: unexpected or duplicate failed test: {title}')
            seen.add(label)
            if "failureType: 'testCodeFailure'" not in details or                     "code: 'ERR_ASSERTION'" not in details or                     "name: 'AssertionError'" not in details:
                raise RuntimeError(f'{report["log"]}: {label} failed for a non-assertion reason')
            for fingerprint in EXPECTED_RED_DIAGNOSTICS[label]:
                if fingerprint not in details:
                    raise RuntimeError(f'{report["log"]}: {label} did not fail for the expected reason ({fingerprint})')
        if seen!=set(names):
            raise RuntimeError(f'{report["log"]}: expected failures absent: {set(names)-seen}')
    return matches

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--verify-only',action='store_true')
    ap.add_argument('--require-exact',action='store_true',help='STRICT CI: npm ci from frozen lockfile, check local compiler version before running')
    ap.add_argument('--output-dir',default='results_stage0')
    opts=ap.parse_args()
    baselines=verify()
    if opts.verify_only and opts.require_exact:
        raise RuntimeError('--verify-only never represents exact dependency validation')
    if opts.verify_only:
        print(json.dumps({'archive_integrity':baselines},indent=2));return
    output=Path(opts.output_dir).resolve();output.mkdir(parents=True,exist_ok=True)
    versions={'python':sys.version.split()[0]}
    node=shutil.which('node');tsc=shutil.which('tsc');npm=shutil.which('npm')
    if not node or not npm or (not opts.require_exact and not tsc):
        raise RuntimeError('Node and npm required; diagnostic mode additionally requires global tsc')
    versions['node']=subprocess.check_output([node,'-v'],text=True).strip()
    versions['npm']=subprocess.check_output([npm,'-v'],text=True).strip()
    versions['typescript_on_PATH']=subprocess.check_output([tsc,'-v'],text=True).strip() if tsc else 'not-installed'
    versions['exact_dependency_gate']='PENDING: npm ci not run'
    # Only diagnostic mode may rely on globally installed TS. Strict mode runs
    # npm ci from the frozen lockfile in a disposable workspace, then uses that
    # exact local compiler. A synthetic tsc 5.9.3 on PATH is not sufficient.
    extra_env=os.environ.copy()
    if not opts.require_exact:
        global_nm=str(Path(os.path.realpath(tsc)).parents[2])
        extra_env['NODE_PATH']=os.pathsep.join(filter(None,[global_nm,extra_env.get('NODE_PATH','')]))
    elif not versions['node'].startswith('v22.'):
        raise RuntimeError('EXACT CI requires Node 22.x, found '+versions['node'])
    runs={}
    with tempfile.TemporaryDirectory(prefix='ballina-stage0-') as tmp:
        root=Path(tmp)
        safe_extract(ARCH/'Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip',root/'candidate')
        safe_extract(ARCH/'Ballina_Move_v0.9.9_UPLOAD_GITHUB_83_ARQUIVOS.zip',root/'main_partial')
        safe_extract(ARCH/INDEPENDENT,root/'independent_evidence')
        if opts.require_exact:
            # Lockfile provenance is protected by the candidate archive SHA,
            # checked above. npm ci validates integrity using the lockfile.
            routing=root/'candidate/routing'
            npm_log=output/'npm_ci_locked.log'
            npm_result=run([npm,'ci','--ignore-scripts','--no-audit','--no-fund'],routing,npm_log,extra_env,timeout=120)
            if npm_result['exit']!=0:
                raise RuntimeError('LOCKFILE INSTALL BLOCKED: npm ci failed; inspect npm_ci_locked.log')
            local_tsc=routing/'node_modules/.bin/tsc'
            if not local_tsc.is_file():raise RuntimeError('npm ci missing local TypeScript compiler')
            ts_actual=subprocess.check_output([str(local_tsc),'-v'],text=True).strip()
            if ts_actual!='Version 5.9.3':
                raise RuntimeError(f'LOCKFILE COMPILER MISMATCH: {ts_actual}')
            tsc=str(local_tsc)
            # The legacy parity verifier requires require('typescript'); resolve
            # the npm-ci installed module, not a globally installed fallback.
            extra_env['NODE_PATH']=str(routing/'node_modules')
            versions['typescript']=ts_actual
            versions['exact_dependency_gate']='PASSED: npm ci from frozen package-lock.json'
        else:
            versions['typescript']=versions['typescript_on_PATH']

        shutil.copytree(HERE/'checks',root/'checks')
        (root/'tools').mkdir()
        shutil.copy2(HERE/'tools/benchmark_offline.cjs',root/'tools/benchmark_offline.cjs')
        def step(name,cmd,cwd,expected_rc=0,timeout=150):
            r=run(cmd,cwd,output/f'{name}.log',extra_env,timeout=timeout)
            runs[name]={k:v for k,v in r.items() if k!='output'}
            if r['exit']!=expected_rc:raise RuntimeError(f'{name}: returned {r["exit"]} (expected {expected_rc}); inspect log')
            return r
        step('compile_v099_partial',[tsc,'-p','tsconfig.json'],root/'main_partial/routing')
        t099=sorted(str(x) for x in (root/'main_partial/routing/tests').glob('*.test.cjs'))
        t=step('tests_v099_partial',[node,'--test',*t099],root/'main_partial/routing')
        check_tap(t,204,204,0)
        step('compile_v010',[tsc,'-p','tsconfig.json'],root/'candidate/routing')
        t010=sorted(str(x) for x in (root/'candidate/routing/tests').glob('*.test.cjs'))
        t=step('tests_v010',[node,'--test',*t010],root/'candidate/routing')
        check_tap(t,245,245,0)
        step('artifact_parity',[node,'scripts/verify_singlefile_parity_010.cjs'],root/'candidate/routing')
        t=step('sealed_gate',[node,'--test','staging/tests/sealed_gate.test.cjs'],root/'candidate')
        check_tap(t,6,6,0)
        red=step('expected_red_regressions',[node,'--test','checks/regressoes_A01_A06.test.cjs'],root,expected_rc=1)
        check_tap(red,6,0,6,EXPECTED)
        # Claude-authored independent script expects ./independent_candidate/routing/dist;
        # create SYMLINK pointing to the frozen candidate in the disposable workspace.
        (root/'independent_candidate').symlink_to(root/'candidate',target_is_directory=True)
        shutil.copy2(root/'independent_evidence/independent_checks.cjs',root/'independent_checks.cjs')
        independent=step('independent_counterexamples',[node,'independent_checks.cjs'],root)
        for name in EXPECTED:
            if f'"finding":"{name}"' not in independent['output']:
                raise RuntimeError(f'Independent auditor finding missing: {name}')
        step('benchmark_offline',[node,'tools/benchmark_offline.cjs'],root)
    report={'stage':'0','meaning':'candidate unchanged; expected six failing contract tests preserve proof of old defects',
            'github_main_commit':'4e4c6d36bc7542b8258ccf6efde70944f1add592',
            'github_main_local_archive':'PARTIAL; 83 files, not authenticated full repository',
            'candidate_archive_sha256':ORIGINALS['Ballina_Move_v0.10.0_AUDITORIA_RODADA3_COMPLETO.zip'],
            'versions':versions,'exact_dependency_gate':versions['exact_dependency_gate'],
            'baselines':baselines,'runs':runs,'status':'LOCAL_STAGE0_REPRODUCED_NOT_PRODUCTION_READY'}
    (output/'RESULTS_STAGE0.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'versions':versions,'tests_v099':204,'tests_v010':245,'stage0_red_expected':6,'independent_checks':6,'logs':str(output)},ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(f'STAGE0 FAILED OR BLOCKED: {e}',file=sys.stderr)
        raise SystemExit(1)
