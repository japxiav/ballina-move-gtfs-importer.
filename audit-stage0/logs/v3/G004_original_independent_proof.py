#!/usr/bin/env python3
"""Prova isolada de falha de verificação da árvore vs. worktree em G0-04.
Não faz rede, não toca no GitHub e não altera código Ballina Move.
Usa um repositório temporário com constantes do verificador substituídas em memória.
"""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile

if len(sys.argv) != 2:
    raise SystemExit('Uso: python Ballina_Move_G0-04_Prova_Negativa_2026-10-09.py PATH/ci/verify_full_github_main.py')
spec = importlib.util.spec_from_file_location('ballina_main_gate',sys.argv[1])
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
with tempfile.TemporaryDirectory(prefix='ballina-g004-') as tmp:
    repo=pathlib.Path(tmp)
    def git(*a):
        return subprocess.run(['git','-C',str(repo),*a],check=True,capture_output=True,text=True).stdout.strip()
    git('init','-q')
    git('config','user.name','Gate Test')
    git('config','user.email','gate-test@example.invalid')
    tracked=repo/'import_gtfs.py'
    tracked.write_text('print("ORIGINAL")\n')
    git('add','import_gtfs.py')
    git('commit','-qm','Original test')
    gate.COMMIT=git('rev-parse','HEAD')
    gate.EXPECTED_BLOBS=1
    before=gate.check(repo)
    tracked.write_text('print("MODIFIED WORKTREE")\n')
    after=gate.check(repo)
    differs=subprocess.run(['git','-C',str(repo),'diff','--quiet','HEAD'],capture_output=True).returncode != 0
    print('Tracked worktree file modified:',differs)
    print('Gate accepted original:',before['blob_hashes_recomputed']==1)
    print('Gate accepted modified:',after['blob_hashes_recomputed']==1)
    print('Identical verification outputs:',before==after)
    assert differs and before==after
    print('G0-04 REPRODUCED: verifies objects in HEAD, not the working-tree files executed by tests')
