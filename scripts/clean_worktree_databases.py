#!/usr/bin/env python
"""Drop the dev databases belonging to *this* worktree, and nothing else.

Every agent that finishes a branch has to clean up after itself, and the
dangerous version of that is a hand-written ``LIKE 'ragworks%'`` sweep: it
matches every other worktree's databases too, and a neighbouring suite run
dies on a database that vanished mid-``CREATE DATABASE … TEMPLATE``. Deriving
the worktree key by hand is more work than typing the glob, so the safe thing
has to be the easy thing — this script computes the same keys the harness
uses and can therefore only ever name its own databases.

Two further safety properties, both deliberate:

- **No ``WITH (FORCE)``.** A database with an open connection is a live run —
  this worktree's own suite or sandbox. The drop fails and says so rather than
  killing it.
- **Templates are never touched.** ``ragworks_tmpl_*`` is keyed by schema hash,
  not by worktree, so it is shared with every other checkout on the machine.
  `make test-clean-templates` sweeps those on purpose, when nothing is running.

It sweeps *both* servers the harness can write to. `make test` uses the
Dockerized dev database, but a bare ``uv run pytest`` falls back to
``DEFAULT_TEST_DATABASE_URL`` on the native server — so stragglers collect in
two places, and a cleanup that knows about one of them leaves half the mess
behind. A server that does not answer is skipped, not an error: most machines
run only one of the two.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url

# `ragworks_test_<key>_<worker>` and `ragworks_sandbox_<key>`, where the key is
# the worktree md5 prefix. Matching it back out is what makes orphan detection
# decidable rather than a guess.
_KEYED_NAME = re.compile(r"^ragworks_(?:test|sandbox)_([0-9a-f]{8})(?:_.+)?$")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_URL = "postgresql+psycopg://ragworks:ragworks@localhost:54329/postgres"
# Where a bare `uv run pytest` lands, mirroring tests/utils/db.py's fallback.
NATIVE_FALLBACK_URL = "postgresql+psycopg://localhost:5432/postgres"


def _worktree_key() -> str:
    """The md5-of-path key both the test harness and the sandbox derive."""
    return hashlib.md5(str(REPO_ROOT).encode()).hexdigest()[:8]


def owned_database_names() -> tuple[str, str]:
    """Return this worktree's `(test-database prefix, sandbox name)`.

    Mirrors `tests/utils/db.py::worker_database_name` (per-worker test
    databases) and `sandbox/config.py` (one sandbox database). The main
    checkout's sandbox has no suffix, which is why it is named explicitly
    rather than derived from the key.
    """
    key = _worktree_key()
    sandbox = f"ragworks_sandbox_{key}" if (REPO_ROOT / ".git").is_file() else "ragworks_sandbox"
    return (f"ragworks_test_{key}_", sandbox)


def live_worktree_keys() -> set[str]:
    """The database key of every worktree that still exists on disk.

    A database whose key is in no live worktree is orphaned by definition —
    its worktree is gone, so nothing can ever be running in it. That is the
    one claim strong enough to justify dropping a database this process does
    not own, and it is only decidable because the name encodes the path.
    """
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
        cwd=REPO_ROOT,
    )
    keys = set()
    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            path = Path(line[len("worktree ") :]).resolve()
            keys.add(hashlib.md5(str(path).encode()).hexdigest()[:8])
    return keys


def _server_urls() -> list[str]:
    """Every server the harness can put this worktree's databases on."""
    configured = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL") or DEFAULT_URL
    candidates = [configured, DEFAULT_URL, NATIVE_FALLBACK_URL]
    seen: set[tuple[str | None, int | None]] = set()
    unique: list[str] = []
    for candidate in candidates:
        url = make_url(candidate)
        key = (url.host, url.port)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _targets(names: list[str], owned: tuple[str, str], live_keys: set[str]) -> list[str]:
    """Select this worktree's databases plus any whose worktree is gone."""
    test_prefix, sandbox_name = owned
    selected = []
    for name in names:
        if name.startswith(test_prefix) or name == sandbox_name:
            selected.append(name)
            continue
        match = _KEYED_NAME.match(name)
        if match and match.group(1) not in live_keys:
            selected.append(name)
    return selected


def _clean_server(
    candidate: str,
    owned: tuple[str, str],
    live_keys: set[str],
) -> tuple[int, int]:
    """Drop this worktree's and every orphaned database on one server."""
    url = make_url(candidate).set(database="postgres")
    engine = create_engine(url, isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 3})
    try:
        connection = engine.connect()
    except Exception:
        # An absent server is the normal case, not a failure: most machines run
        # either the Dockerized dev database or a native one, never both.
        return (0, 0)
    with connection:
        all_names = [
            row[0]
            for row in connection.execute(
                text(
                    "SELECT datname FROM pg_database "
                    "WHERE datname LIKE 'ragworks%' AND datname NOT LIKE 'ragworks_tmpl_%' "
                    "ORDER BY datname"
                )
            )
        ]
        names = _targets(all_names, owned, live_keys)
        dropped = kept = 0
        for name in names:
            try:
                connection.execute(text(f'DROP DATABASE "{name}"'))
            except Exception as exc:
                # Reported per database and never fatal: one live database must
                # not stop the rest of this worktree's from being cleaned up.
                kept += 1
                print(f"kept    {name} on {url.host}:{url.port} (in use? {type(exc).__name__})")
            else:
                dropped += 1
                print(f"dropped {name} on {url.host}:{url.port}")
        return (dropped, kept)


def main() -> int:
    """Drop this worktree's databases, and any whose worktree no longer exists."""
    owned = owned_database_names()
    live_keys = live_worktree_keys()
    dropped = kept = 0
    for candidate in _server_urls():
        server_dropped, server_kept = _clean_server(candidate, owned, live_keys)
        dropped += server_dropped
        kept += server_kept
    if not dropped and not kept:
        print("No databases for this worktree.")
        return 0
    if kept:
        print(f"\n{kept} database(s) still in use — stop the run or sandbox using them.")
    return 1 if kept else 0


if __name__ == "__main__":
    sys.exit(main())
