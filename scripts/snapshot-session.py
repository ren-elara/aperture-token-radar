"""Take a consistent SQLite backup without modifying the original OpenCode store.

No message, part, usage record or timestamp is rewritten. make.fun's bundle
selects the requested session from this native-format database snapshot.
"""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path('/public/farm/ren-elara/.local/share/opencode/opencode.db')
DESTINATION = ROOT / 'sessions' / 'opencode.db'

if not DESTINATION.parent.is_dir():
    raise RuntimeError('Create the local sessions directory before taking a snapshot')

with sqlite3.connect(f'file:{SOURCE}?mode=ro', uri=True) as original:
    with sqlite3.connect(DESTINATION) as snapshot:
        original.backup(snapshot)
        if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('OpenCode database snapshot failed integrity_check')

DESTINATION.chmod(0o600)
print('Created a consistent native OpenCode database snapshot; original opened read-only.')
