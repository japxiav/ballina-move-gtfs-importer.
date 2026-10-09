#!/usr/bin/env python3
"""G0-04: offline Git commit AND executed-worktree audit.

This is a verifier, not a checkout utility. It does not clone, fetch, modify Git
metadata, or touch a production service. Use on a disposable checkout. It
checks Git objects, index entries, exact worktree contents (including executable
bits and symlinks), and absence of extra files, even if Git ignores them.

Scope: a local point-in-time verification before and after Python importer tests;
not a filesystem lock or an attestation of external provenance.
"""
import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath

COMMIT = '4e4c6d36bc7542b8258ccf6efde70944f1add592'
EXPECTED_BLOBS = 101


def git(root, *cmd, input=None):
    return subprocess.run(
        ['git', '-C', str(root), *cmd], input=input,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout


def blob_sha1(content):
    """Hash exact bytes as a Git SHA-1 blob, not through Git clean filters."""
    return hashlib.sha1(b'blob ' + str(len(content)).encode('ascii') + b'\0' + content).hexdigest()


def _parse_tree(root):
    raw = git(root, 'ls-tree', '-r', '-z', 'HEAD')
    expected = {}
    for entry in raw.split(b'\0'):
        if not entry:
            continue
        meta, path_bytes = entry.split(b'\t', 1)
        mode_bytes, kind, sha_bytes = meta.split(b' ')
        if kind != b'blob':
            raise RuntimeError('Non-blob encountered in checkout tree')
        mode = mode_bytes.decode('ascii')
        if mode not in ('100644', '100755', '120000'):
            raise RuntimeError('Unsupported checkout mode: ' + mode)
        # Explicitly reject paths with platform-specific ambiguities.
        rel = os.fsdecode(path_bytes)
        pure = PurePosixPath(rel)
        if pure.is_absolute() or '..' in pure.parts or '.git' in pure.parts or not rel or '\\' in rel:
            raise RuntimeError('Unsafe checkout path: ' + repr(rel))
        if rel in expected:
            raise RuntimeError('Duplicate checkout tree path: ' + repr(rel))
        expected[rel] = {'mode': mode, 'blob': sha_bytes.decode('ascii')}
    if len(expected) != EXPECTED_BLOBS:
        raise RuntimeError(f'Expected {EXPECTED_BLOBS} tracked files, found {len(expected)}')
    return expected


def _parse_index(root):
    """Compare staged index entries against commit, independently of git status."""
    staged = {}
    for entry in git(root, 'ls-files', '--stage', '-z').split(b'\0'):
        if not entry:
            continue
        meta, path_bytes = entry.split(b'\t', 1)
        mode, sha, stage = (s.decode('ascii') for s in meta.split(b' '))
        rel = os.fsdecode(path_bytes)
        if stage != '0' or rel in staged:
            raise RuntimeError('Unmerged/duplicate staged path: ' + repr(rel))
        staged[rel] = {'mode': mode, 'blob': sha}
    return staged


def _inventory_worktree(root):
    """No ignored/untracked files can shadow imports or execution inputs."""
    existing = set()
    stack = [root]
    while stack:
        directory = stack.pop()
        with os.scandir(directory) as items:
            for item in items:
                if directory == root and item.name == '.git':
                    continue
                path = Path(item.path)
                rel = path.relative_to(root).as_posix()
                if item.is_symlink():
                    existing.add(rel)
                elif item.is_dir(follow_symlinks=False):
                    stack.append(path)
                elif item.is_file(follow_symlinks=False):
                    existing.add(rel)
                else:
                    raise RuntimeError('Unsupported worktree entry type: ' + repr(rel))
    return existing


def _verify_worktree(root, expected):
    existing = _inventory_worktree(root)
    expected_paths = set(expected)
    extra = sorted(existing - expected_paths)
    missing = sorted(expected_paths - existing)
    if extra:
        raise RuntimeError(f'Unexpected worktree files (including ignored): {extra[:8]}')
    if missing:
        raise RuntimeError(f'Missing tracked worktree files: {missing[:8]}')

    for rel, entry in expected.items():
        path = root.joinpath(*PurePosixPath(rel).parts)
        mode = entry['mode']
        metadata = path.lstat()
        if mode == '120000':
            if not stat.S_ISLNK(metadata.st_mode):
                raise RuntimeError('Expected symlink, found other type: ' + rel)
            content = os.fsencode(os.readlink(path))
        else:
            if not stat.S_ISREG(metadata.st_mode):
                raise RuntimeError('Expected regular file, found other type: ' + rel)
            is_executable = bool(metadata.st_mode & 0o111)
            if is_executable != (mode == '100755'):
                raise RuntimeError('Executable bit mismatch: ' + rel)
            content = path.read_bytes()
        got = blob_sha1(content)
        if got != entry['blob']:
            raise RuntimeError('Executed worktree differs from committed blob: ' + rel)
    return len(existing)


def check(root):
    root = Path(root).resolve()
    if not root.is_dir():
        raise RuntimeError('Checkout directory missing')
    actual_root = Path(os.fsdecode(git(root, 'rev-parse', '--show-toplevel').strip())).resolve()
    if actual_root != root:
        raise RuntimeError('Provided directory is not the repository top-level')
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    if head != COMMIT:
        raise RuntimeError(f'Checkout mismatch: {head}, expected {COMMIT}')
    expected = _parse_tree(root)
    staged = _parse_index(root)
    if staged != expected:
        raise RuntimeError('Git index differs from the pinned commit tree')

    # Verify the local Git objects themselves, not only the working tree.
    for rel, entry in expected.items():
        content = git(root, 'cat-file', 'blob', entry['blob'])
        if blob_sha1(content) != entry['blob']:
            raise RuntimeError('Corrupted Git blob object: ' + rel)

    worktree_count = _verify_worktree(root, expected)
    inventory = [{'path': rel, 'mode': v['mode'], 'blob_sha1': v['blob']}
                 for rel, v in sorted(expected.items())]
    return {
        'commit': head,
        'tree_entries': len(expected),
        'blob_hashes_recomputed': len(expected),
        'index_entries_verified': len(staged),
        'executed_worktree_files_verified': worktree_count,
        'ignored_and_untracked_files_found': 0,
        'inventory_sha256': hashlib.sha256(
            json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode()
        ).hexdigest(),
        'guarantee_scope': 'commit objects + Git index + exact worktree snapshot; not a filesystem lock',
    }


def run_importer_tests(checkout, runner=sys.executable):
    env = os.environ.copy()
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    env['PYTHONNOUSERSITE'] = '1'
    for name in list(env):
        if any(term in name.upper() for term in (
            'SUPABASE', 'IMPORT_TOKEN', 'NTA_API', 'STADIA', 'SERVICE_ROLE',
        )):
            env.pop(name, None)
    completed = subprocess.run(
        [runner, '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
        cwd=checkout, env=env, capture_output=True, text=True, timeout=150,
    )
    return {'exit': completed.returncode, 'log': completed.stdout + '\n' + completed.stderr}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkout', required=True, type=Path)
    parser.add_argument('--metadata-only', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = args.checkout.resolve()
    if args.output is not None:
        report_path = args.output.resolve()
        if report_path == root or root in report_path.parents:
            raise RuntimeError('Report output must be outside the verified checkout')
    before = check(root)
    result = {'pre_test': before, 'python_importer_tests': 'NOT_RUN (--metadata-only)'}
    if not args.metadata_only:
        # No test runs until the actual worktree is verified.
        suite = run_importer_tests(root)
        result['python_importer_tests'] = {
            'exit': suite['exit'],
            'tail': suite['log'][-6000:],
        }
        # Always examine post-test worktree, even when the suite fails.
        after = check(root)
        result['post_test'] = after
        if after != before:
            raise RuntimeError('Checkout identity changed during test execution')
        if suite['exit'] != 0:
            raise RuntimeError('Full main importer tests failed; inspect test output')
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FULL_MAIN_GATE_BLOCKED:', str(exc), file=sys.stderr)
        raise SystemExit(1)
