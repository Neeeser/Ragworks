"""Start, stop, and inspect the sandbox backend and frontend servers.

Servers run as detached process groups with pidfiles and logs under
`.sandbox/`, so any later invocation (or a different agent session) can stop or
inspect them. The backend binds the sandbox database and storage; the frontend
is the normal Next.js dev server pointed at the sandbox API port.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from sandbox import config

BACKEND_PIDFILE = config.RUNTIME_DIR / "backend.pid"
FRONTEND_PIDFILE = config.RUNTIME_DIR / "frontend.pid"
FRONTEND_MODE_FILE = config.RUNTIME_DIR / "frontend.mode"
BACKEND_LOG = config.LOGS_DIR / "backend.log"
FRONTEND_LOG = config.LOGS_DIR / "frontend.log"


@dataclass(frozen=True)
class ServerStatus:
    """Liveness of one managed server."""

    name: str
    running: bool
    pid: int | None
    url: str


def start_backend() -> None:
    """Launch uvicorn against the sandbox environment and wait for /api/health."""
    _spawn(
        BACKEND_PIDFILE,
        BACKEND_LOG,
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.api.main:app",
            "--host",
            config.API_HOST,
            "--port",
            str(config.API_PORT),
        ],
        env={**os.environ, **config.backend_env()},
    )
    _wait_http(f"{config.API_BASE_URL}/api/health", timeout=60.0, log=BACKEND_LOG)


def start_frontend(mode: str = "dev") -> None:
    """Launch the Next.js frontend pointed at the sandbox API and wait for it.

    Two modes, tracked in a marker file so a running server of the other mode
    is replaced instead of reused:

    - ``dev``: `next dev`, for interactive testing with hot reload.
    - ``prod``: `next build` + `next start`, for scripted browser flows —
      dev-mode HMR/on-demand compilation triggers full-page reload storms
      under Playwright that wipe in-flight client state (a login redirect
      repeatedly bounced back to the sign-in page until flows moved to a
      production build).

    A frontend already running in the requested mode is reused: it is
    stateless across scenarios — only the backend's data changes.
    """
    existing = _read_pid(FRONTEND_PIDFILE)
    if existing is not None and _alive(existing):
        if _frontend_mode() == mode:
            return
        _stop("frontend", FRONTEND_PIDFILE)
    frontend_dir = config.REPO_ROOT / "frontend"
    if not (frontend_dir / "node_modules").exists():
        raise SystemExit("frontend/node_modules missing — run `make env-frontend` first.")
    env = {**os.environ, "NEXT_PUBLIC_API_BASE_URL": config.API_BASE_URL}
    if mode == "prod":
        # NEXT_PUBLIC_* values are baked at build time, so the build itself
        # must run under the sandbox environment.
        print("building production frontend for flows (next build) …")
        build = subprocess.run(
            ["npm", "--prefix", str(frontend_dir), "run", "build"],
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        if build.returncode != 0:
            raise SystemExit(f"frontend build failed:\n{build.stdout[-2000:]}")
        command = ["npm", "--prefix", str(frontend_dir), "run", "start", "--", "-p"]
    else:
        command = ["npm", "--prefix", str(frontend_dir), "run", "dev", "--", "-p"]
    _spawn(FRONTEND_PIDFILE, FRONTEND_LOG, [*command, str(config.FRONTEND_PORT)], env=env)
    FRONTEND_MODE_FILE.write_text(mode, encoding="utf-8")
    _wait_http(config.FRONTEND_BASE_URL, timeout=180.0, log=FRONTEND_LOG)


def _frontend_mode() -> str:
    try:
        return FRONTEND_MODE_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return "dev"


def stop_all() -> list[str]:
    """Stop both servers if running; return a line per action taken."""
    return _stop("frontend", FRONTEND_PIDFILE) + _stop("backend", BACKEND_PIDFILE)


def stop_backend() -> list[str]:
    """Stop only the backend — reseeding replaces its database, but the
    frontend is stateless across scenarios and stays warm."""
    return _stop("backend", BACKEND_PIDFILE)


def _stop(name: str, pidfile: Path) -> list[str]:
    pid = _read_pid(pidfile)
    if pid is None or not _alive(pid):
        pidfile.unlink(missing_ok=True)
        return []
    _terminate(pid)
    pidfile.unlink(missing_ok=True)
    return [f"stopped {name} (pid {pid})"]


def statuses() -> list[ServerStatus]:
    """Report liveness of both servers."""
    return [
        ServerStatus(
            name="backend",
            running=_pidfile_alive(BACKEND_PIDFILE),
            pid=_read_pid(BACKEND_PIDFILE),
            url=config.API_BASE_URL,
        ),
        ServerStatus(
            name="frontend",
            running=_pidfile_alive(FRONTEND_PIDFILE),
            pid=_read_pid(FRONTEND_PIDFILE),
            url=config.FRONTEND_BASE_URL,
        ),
    ]


def any_running() -> bool:
    """True when either managed server is alive."""
    return any(status.running for status in statuses())


def _spawn(pidfile: Path, log: Path, command: list[str], env: dict[str, str]) -> None:
    """Start a detached process group, logging to `log`, recording its pid."""
    existing = _read_pid(pidfile)
    if existing is not None and _alive(existing):
        raise SystemExit(
            f"{pidfile.stem} is already running (pid {existing}) — run `sandbox down` first."
        )
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("ab") as sink:
        process = subprocess.Popen(  # pylint: disable=consider-using-with
            command,
            stdout=sink,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=config.REPO_ROOT,
            start_new_session=True,
        )
    pidfile.write_text(str(process.pid), encoding="utf-8")


def _wait_http(url: str, *, timeout: float, log: Path) -> None:
    """Poll `url` until it answers 2xx/3xx, or fail pointing at the log."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            response = httpx.get(url, timeout=2.0, follow_redirects=True)
            if response.status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise SystemExit(f"{url} did not come up within {int(timeout)}s — see {log}")


def _terminate(pid: int) -> None:
    """SIGTERM the process group, escalating to SIGKILL after a grace period.

    Signal errors are tolerated: the group can die (or its pid be recycled by
    an unrelated process we may not signal) between the liveness check and
    the kill — either way there is nothing left of ours to stop.
    """
    try:
        group = os.getpgid(pid) if _alive(pid) else None
        if group is None:
            return
        os.killpg(group, signal.SIGTERM)
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            if not _alive(pid):
                return
            time.sleep(0.2)
        os.killpg(group, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        return


def _read_pid(pidfile: Path) -> int | None:
    try:
        return int(pidfile.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _pidfile_alive(pidfile: Path) -> bool:
    pid = _read_pid(pidfile)
    return pid is not None and _alive(pid)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True
