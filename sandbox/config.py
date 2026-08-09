"""Sandbox harness constants and environment wiring.

Everything the harness needs to isolate itself from dev state lives here:
the dedicated database, ports offset from the dev servers, and a runtime
directory (`.sandbox/`) for storage, config, logs, and pids. Values are
test-tooling defaults — overridable via environment (or `.env.sandbox`), never
read by the app itself.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from sqlalchemy.engine.url import make_url

REPO_ROOT = Path(__file__).resolve().parent.parent


def _worktree_suffix() -> str:
    """Per-worktree isolation suffix, empty in the main checkout.

    A linked git worktree has a `.git` *file* (the main checkout has a
    directory). Sandboxes in linked worktrees get their own database name and
    port offset so concurrent agents don't drop each other's sandbox database
    or race for ports 8010/3010; the main checkout keeps the documented
    defaults. Everything downstream (CLI output, handoff.json, flows) reads
    the derived values, never literals.
    """
    if not (REPO_ROOT / ".git").is_file():
        return ""
    return hashlib.md5(str(REPO_ROOT).encode()).hexdigest()[:8]


_SUFFIX = _worktree_suffix()
_PORT_OFFSET = (int(_SUFFIX, 16) % 400) + 1 if _SUFFIX else 0
_DB_NAME = f"ragworks_sandbox_{_SUFFIX}" if _SUFFIX else "ragworks_sandbox"

DEFAULT_SANDBOX_DATABASE_URL = (
    f"postgresql+psycopg://ragworks:ragworks@localhost:54329/{_DB_NAME}"
)

API_HOST = "127.0.0.1"
API_PORT = int(os.getenv("SANDBOX_API_PORT", str(8010 + _PORT_OFFSET)))
FRONTEND_PORT = int(os.getenv("SANDBOX_FRONTEND_PORT", str(3010 + _PORT_OFFSET)))
API_BASE_URL = f"http://{API_HOST}:{API_PORT}"
FRONTEND_BASE_URL = f"http://{API_HOST}:{FRONTEND_PORT}"

RUNTIME_DIR = REPO_ROOT / ".sandbox"
STORAGE_PATH = RUNTIME_DIR / "storage"
CONFIG_PATH = RUNTIME_DIR / "config"
LOGS_DIR = RUNTIME_DIR / "logs"
HANDOFF_PATH = RUNTIME_DIR / "handoff.json"

def _resolve_env_file(repo_root: Path) -> Path:
    """Resolve ``.env.sandbox``, falling back to the main checkout's copy.

    The file is gitignored, so a linked worktree starts without one and every
    scenario there would fail preflight. A worktree's ``.git`` is a *file*
    whose ``gitdir:`` line points at ``<main>/.git/worktrees/<name>``; walk up
    from it to the main checkout and use its file when the worktree has none.
    A ``.env.sandbox`` present in the worktree itself still wins, so a
    worktree can pin its own keys.
    """
    local = repo_root / ".env.sandbox"
    git_marker = repo_root / ".git"
    if local.exists() or not git_marker.is_file():
        return local
    gitdir_line = git_marker.read_text(encoding="utf-8").strip()
    if not gitdir_line.startswith("gitdir:"):
        return local
    gitdir = Path(gitdir_line.removeprefix("gitdir:").strip())
    if not gitdir.is_absolute():
        gitdir = (repo_root / gitdir).resolve()
    if gitdir.parent.name != "worktrees" or gitdir.parent.parent.name != ".git":
        return local
    main_env = gitdir.parent.parent.parent / ".env.sandbox"
    return main_env if main_env.exists() else local


ENV_FILE = _resolve_env_file(REPO_ROOT)

SANDBOX_EMAIL = "sandbox@ragworks.dev"
SANDBOX_PASSWORD = "ragworks-sandbox"
SANDBOX_FULL_NAME = "Sandbox Tester"


def database_url() -> str:
    """The sandbox database URL (override: ``SANDBOX_DATABASE_URL``)."""
    return os.getenv("SANDBOX_DATABASE_URL", DEFAULT_SANDBOX_DATABASE_URL)


def maintenance_database_url() -> str:
    """Same server as `database_url`, but the dev database — used to
    drop/recreate the sandbox database, which can't be done from a connection to
    itself."""
    url = make_url(database_url()).set(database="ragworks")
    # str(URL) masks the password as `***`; render it usable.
    return url.render_as_string(hide_password=False)


def default_embedding_model() -> str:
    """OpenRouter embedding model scenarios seed (override: ``SANDBOX_EMBEDDING_MODEL``)."""
    return os.getenv("SANDBOX_EMBEDDING_MODEL", "openai/text-embedding-3-small")


def multimodal_embedding_provider() -> str:
    """Provider serving the image-capable embedding model (``SANDBOX_MM_PROVIDER``)."""
    return os.getenv("SANDBOX_MM_PROVIDER", "cohere")


def multimodal_embedding_model() -> str:
    """Image-capable embedding model scenarios seed (``SANDBOX_MM_EMBEDDING_MODEL``)."""
    return os.getenv("SANDBOX_MM_EMBEDDING_MODEL", "embed-v4.0")


def default_chat_model() -> str:
    """OpenRouter chat model scenarios seed (override: ``SANDBOX_CHAT_MODEL``)."""
    return os.getenv("SANDBOX_CHAT_MODEL", "openai/gpt-4o-mini")


def backend_env() -> dict[str, str]:
    """Environment that binds a backend process to the sandbox world."""
    cors = json.dumps(
        [FRONTEND_BASE_URL, f"http://localhost:{FRONTEND_PORT}"]
    )
    return {
        "DATABASE_URL": database_url(),
        "FILE_STORAGE_PATH": str(STORAGE_PATH),
        "CONFIG_PATH": str(CONFIG_PATH),
        "DEBUG": "true",
        "CORS_ORIGINS": cors,
    }


def apply_backend_env() -> None:
    """Point this process at the sandbox world.

    Must run before any ``app.*`` import: ``app.db.engine`` creates the
    process-wide engine from ``DATABASE_URL`` at import time.
    """
    os.environ.update(backend_env())
    for path in (RUNTIME_DIR, STORAGE_PATH, CONFIG_PATH, LOGS_DIR):
        path.mkdir(parents=True, exist_ok=True)
