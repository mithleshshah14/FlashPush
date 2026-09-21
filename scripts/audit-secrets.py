"""Scans everything reachable from any git ref for secrets, and reports personal data. Prints file names and
pattern names only, never the matched values.

    python scripts/audit-secrets.py            full report (secrets fail the run, personal data is listed)
    python scripts/audit-secrets.py --quiet    only fail with a short message when a secret is found (for the pre-push hook)

Why history and not just the current files: on a public repository every old commit can be cloned, so a secret
that was "deleted" in a later commit is still published.
"""
import collections
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SECRETS = {
    'private key block': r'-----BEGIN [A-Z ]*PRIVATE KEY-----',
    'github token': r'\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})',
    'aws access key': r'\bAKIA[0-9A-Z]{16}\b',
    'google api key': r'\bAIza[0-9A-Za-z_\-]{35}\b',
    'slack token': r'\bxox[baprs]-[A-Za-z0-9-]{10,}',
    'jwt': r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',
    'android signing': r'\b(storePassword|keyPassword)\s*[=:]',
    'assigned secret-looking value': r'(?i)\b(api[_-]?key|secret|passwd|password|access[_-]?token|auth[_-]?token|bearer)\b\s*[:=]\s*["\'][A-Za-z0-9_\-+/=]{16,}["\']',
}

# Personal data is a warning, not a failure: sample names and example addresses are expected in test fixtures.
PERSONAL = {
    'real Windows user folder (C:\\Users\\<name>, other than the Me/Zo/Public fixtures)': r'C:\\+Users\\+(?!Me\b|Zo|Public\b)[^\\\s"\']+',
    'email address (other than noreply@anthropic.com)': r'(?<![A-Za-z0-9._%+-])(?![A-Za-z0-9._%+-]*noreply@anthropic\.com)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
}

SENSITIVE_NAMES = re.compile(
    r'(\.pem$|\.key$|\.p12$|\.pfx$|\.jks$|\.keystore$|(^|/)\.env|key\.properties$|local\.properties$|google-services\.json$'
    r'|GoogleService-Info\.plist$|id_rsa|\.apk$|\.aab$|(^|/)(devices|items|identity)\.json$)',
    re.I,
)
BINARY = ('.png', '.jpg', '.jpeg', '.ico', '.apk', '.jar', '.so', '.ttf', '.otf', '.woff', '.woff2', '.zip')


def git(*args, stdin=None):
    return subprocess.run(['git', *args], cwd=REPO, input=stdin, capture_output=True, check=True).stdout


def main(quiet):
    paths = collections.defaultdict(set)
    for line in git('rev-list', '--objects', '--all').decode('utf-8', 'replace').splitlines():
        sha, _, name = line.partition(' ')
        if name:
            paths[sha].add(name)
    kinds = git('cat-file', '--batch-check=%(objectname) %(objecttype)', stdin=('\n'.join(paths) + '\n').encode()).decode().splitlines()
    blobs = [k.split()[0] for k in kinds if k.split()[1] == 'blob']
    data = git('cat-file', '--batch', stdin=('\n'.join(blobs) + '\n').encode())

    secret_rx = {k: re.compile(v) for k, v in SECRETS.items()}
    personal_rx = {k: re.compile(v) for k, v in PERSONAL.items()}
    secret_hits = collections.defaultdict(set)
    personal_hits = collections.defaultdict(set)

    pos = 0
    while pos < len(data):
        nl = data.index(b'\n', pos)
        sha, _, size = data[pos:nl].decode().split()
        body = data[nl + 1:nl + 1 + int(size)]
        pos = nl + 1 + int(size) + 1
        names = paths.get(sha) or {'?'}
        if all(n.lower().endswith(BINARY) for n in names):
            continue
        text = body.decode('utf-8', 'replace')
        for label, rx in secret_rx.items():
            if rx.search(text):
                secret_hits[label].update(names)
        for label, rx in personal_rx.items():
            if rx.search(text):
                personal_hits[label].update(names)

    bad_names = sorted({n for ns in paths.values() for n in ns if SENSITIVE_NAMES.search(n)})
    failed = bool(secret_hits or bad_names)

    if quiet:
        if failed:
            print('Push blocked: a secret or a sensitive file is in the repository history. Run: python scripts/audit-secrets.py', file=sys.stderr)
        return 1 if failed else 0

    print(f'{len(blobs)} files (all versions) in {git("rev-list", "--all", "--count").decode().strip()} commits scanned.\n')
    print('SECRETS' + (': none found' if not secret_hits else ''))
    for label, files in secret_hits.items():
        print(f'  {label}: {", ".join(sorted(files)[:6])}')
    print('SENSITIVE FILE NAMES' + (': none ever committed' if not bad_names else ''))
    for name in bad_names[:20]:
        print('  ', name)
    print('PERSONAL DATA (warning only)' + (': none found' if not personal_hits else ''))
    for label, files in personal_hits.items():
        print(f'  {label}: {", ".join(sorted(files)[:6])}')
    print('\nRESULT:', 'FAILED, do not push' if failed else 'ok')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main('--quiet' in sys.argv))
