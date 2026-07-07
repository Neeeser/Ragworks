"""Bump the project version and create the matching release tag.

Owns the semver logic in one place and writes both version files
(pyproject.toml and frontend/package.json) so they cannot drift.

Semantics:
  patch  0.1.0 -> 0.1.1        0.2.0-rc.1 -> 0.2.0 (finalizes; rc is always
                                                     patch-level, so this is
                                                     always correct)
  minor  0.1.1 -> 0.2.0        0.2.0-rc.1 -> 0.2.0 (finalizes; only when the
                                                     rc already sits on a
                                                     minor boundary, patch==0)
                                0.1.1-rc.1 -> 0.2.0 (otherwise bumps minor
                                                     from the base — never
                                                     finalizes down below the
                                                     rc)
  major  1.2.3 -> 2.0.0        1.0.0-rc.1 -> 1.0.0 (finalizes; only when the
                                                     rc already sits on a
                                                     major boundary, minor==0
                                                     and patch==0)
                                0.1.1-rc.1 -> 1.0.0 (otherwise bumps major
                                                     from the base)
  rc     0.1.0 -> 0.1.1-rc.1   0.1.1-rc.1 -> 0.1.1-rc.2

Usage: uv run python scripts/bump_version.py {patch,minor,major,rc}
Refuses to run on a dirty tree, off `main`, or if the target tag exists.
Pushing is deliberately manual: the script prints the exact command.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / "pyproject.toml"
PACKAGE_JSON = ROOT / "frontend" / "package.json"
UV_LOCK = ROOT / "uv.lock"

VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$")
PYPROJECT_VERSION_RE = re.compile(r'^version = "(?P<version>[^"]+)"$', re.MULTILINE)


def bump(version: str, part: str) -> str:
    """Return the next semver for `part` (patch/minor/major/rc)."""
    match = VERSION_RE.match(version)
    if match is None:
        raise ValueError(f"Unrecognized version: {version!r}")
    major, minor, patch = int(match[1]), int(match[2]), int(match[3])
    rc = int(match[4]) if match[4] else None
    if part == "major":
        if rc is not None and minor == 0 and patch == 0:
            return f"{major}.0.0"
        return f"{major + 1}.0.0"
    if part == "minor":
        if rc is not None and patch == 0:
            return f"{major}.{minor}.0"
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch}" if rc is not None else f"{major}.{minor}.{patch + 1}"
    if part == "rc":
        if rc is not None:
            return f"{major}.{minor}.{patch}-rc.{rc + 1}"
        return f"{major}.{minor}.{patch + 1}-rc.1"
    raise ValueError(f"Unknown part: {part!r}")


def _run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True, cwd=ROOT).stdout.strip()


def _fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def _read_current_version() -> str:
    match = PYPROJECT_VERSION_RE.search(PYPROJECT.read_text(encoding="utf-8"))
    if match is None:
        _fail("could not find a version line in pyproject.toml")
        raise AssertionError  # unreachable; _fail exits
    return match.group("version")


def _write_versions(new_version: str) -> None:
    pyproject_text = PYPROJECT.read_text(encoding="utf-8")
    PYPROJECT.write_text(
        PYPROJECT_VERSION_RE.sub(f'version = "{new_version}"', pyproject_text, count=1),
        encoding="utf-8",
    )
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    package["version"] = new_version
    PACKAGE_JSON.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")


def _refresh_lockfile() -> None:
    """Re-lock so uv.lock's pinned root-project version matches pyproject.

    Skipping this breaks every `uv sync --locked` (CI's install step) — the
    v0.1.1-rc.1 release run failed exactly this way. The uv binary comes from
    $UV_BIN (set by the Makefile) since `uv run` doesn't put uv itself on PATH.
    """
    uv_bin = os.environ.get("UV_BIN", "uv")
    subprocess.run([uv_bin, "lock"], check=True, capture_output=True, cwd=ROOT)


def main() -> None:
    """Validate repo state, bump versions, commit, and tag."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("part", choices=["patch", "minor", "major", "rc"])
    args = parser.parse_args()

    if _run("git", "status", "--porcelain"):
        _fail("working tree is dirty; commit or stash first")
    if _run("git", "rev-parse", "--abbrev-ref", "HEAD") != "main":
        _fail("version bumps run from main only")

    current = _read_current_version()
    new_version = bump(current, args.part)
    tag = f"v{new_version}"
    existing = subprocess.run(
        ["git", "rev-parse", "-q", "--verify", f"refs/tags/{tag}"],
        capture_output=True,
        cwd=ROOT,
        check=False,
    )
    if existing.returncode == 0:
        _fail(f"tag {tag} already exists")

    _write_versions(new_version)
    _refresh_lockfile()
    _run("git", "add", str(PYPROJECT), str(PACKAGE_JSON), str(UV_LOCK))
    _run("git", "commit", "-m", f"chore: release {tag}")
    _run("git", "tag", "-a", tag, "-m", tag)

    print(f"{current} -> {new_version}")
    print(f"Created commit and tag {tag}. To publish the release, run:")
    print(f"  git push origin main {tag}")


if __name__ == "__main__":
    main()
