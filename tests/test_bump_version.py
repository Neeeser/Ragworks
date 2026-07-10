"""Semver bump semantics for scripts/bump_version.py."""

import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "bump_version",
    Path(__file__).resolve().parent.parent / "scripts" / "bump_version.py",
)
assert _SPEC is not None
assert _SPEC.loader is not None
bump_version = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(bump_version)


@pytest.mark.parametrize(
    ("current", "part", "expected"),
    [
        ("0.1.0", "patch", "0.1.1"),
        ("0.1.9", "patch", "0.1.10"),
        ("0.1.1", "minor", "0.2.0"),
        ("0.2.0-rc.1", "minor", "0.2.0"),
        ("1.2.3", "major", "2.0.0"),
        # patch on a pre-release finalizes it rather than skipping a version
        ("0.2.0-rc.1", "patch", "0.2.0"),
        # minor on a patch-level rc must bump minor from the base, not
        # finalize down to a version below the rc (a downgrade)
        ("0.1.1-rc.1", "minor", "0.2.0"),
        # major on an rc finalizes only if patch and minor are both 0;
        # otherwise it bumps major from the base
        ("0.1.1-rc.1", "major", "1.0.0"),
        ("1.0.0-rc.1", "major", "1.0.0"),
        # rc from a release starts a new patch pre-release; rc on an rc increments it
        ("0.1.0", "rc", "0.1.1-rc.1"),
        ("0.1.1-rc.1", "rc", "0.1.1-rc.2"),
    ],
)
def test_bump(current: str, part: str, expected: str) -> None:
    assert bump_version.bump(current, part) == expected


def test_bump_rejects_unknown_version_shape() -> None:
    with pytest.raises(ValueError, match="Unrecognized version"):
        bump_version.bump("1.2", "patch")


def test_bump_rejects_unknown_part() -> None:
    with pytest.raises(ValueError, match="Unknown part"):
        bump_version.bump("1.2.3", "banana")


def test_lockfile_pins_current_project_version() -> None:
    """uv.lock records the root project's version; a bump that skips `uv lock`
    breaks every `uv sync --locked` (this failed the v0.1.1-rc.1 release run)."""
    import re
    import tomllib

    root = Path(__file__).resolve().parent.parent
    pyproject_version = re.search(
        r'^version = "([^"]+)"$',
        (root / "pyproject.toml").read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    assert pyproject_version is not None
    lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8"))
    locked = next(p["version"] for p in lock["package"] if p["name"] == "ragworks")

    from packaging.version import Version

    assert Version(locked) == Version(pyproject_version.group(1))


def test_package_lock_pins_current_frontend_version() -> None:
    """package-lock.json records the root project's version twice; a bump that
    skips it leaves the lockfile stale until the next `npm install` regenerates
    it as an unrelated diff (this happened after the v0.1.1 release)."""
    import json

    frontend = Path(__file__).resolve().parent.parent / "frontend"
    version = json.loads((frontend / "package.json").read_text(encoding="utf-8"))["version"]
    lock = json.loads((frontend / "package-lock.json").read_text(encoding="utf-8"))

    assert lock["version"] == version
    assert lock["packages"][""]["version"] == version
