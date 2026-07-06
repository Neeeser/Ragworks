"""Module-size guard: every module under app/ stays at or under MAX_LINES.

This test is the enforcement mechanism for the grandfathered-oversize-modules
burn-down list described in app/AGENTS.md ("The gate"). The GRANDFATHERED dict
below is the single source of truth for that list: each entry maps a
currently-oversize module to its recorded line-count ceiling. A grandfathered
module may shrink but never grow; once it drops to MAX_LINES or below, its
entry must be deleted (the test fails while a satisfied entry lingers, so the
list can't rot). Phases 2-6 of the backend restructure shrink this dict to
empty — new modules never get added to it.
"""

from __future__ import annotations

from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent / "app"

MAX_LINES = 400

# module path (relative to repo root) -> recorded ceiling (its line count when
# grandfathered). Ceilings only ever go DOWN: if you shrink a module, lower its
# ceiling in the same commit; if you empty it below MAX_LINES, delete the entry.
GRANDFATHERED: dict[str, int] = {
    "app/api/routes/collections.py": 478,  # split in Phase 6
}


def _line_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines())


def _app_modules() -> list[Path]:
    return [
        path
        for path in sorted(APP_ROOT.rglob("*.py"))
        if "__pycache__" not in path.parts
    ]


def test_no_module_exceeds_max_lines() -> None:
    """Non-grandfathered app modules stay at or under MAX_LINES."""
    repo_root = APP_ROOT.parent
    offenders = [
        f"{path.relative_to(repo_root)}: {count} lines (max {MAX_LINES})"
        for path in _app_modules()
        if (count := _line_count(path)) > MAX_LINES
        and str(path.relative_to(repo_root)) not in GRANDFATHERED
    ]
    assert not offenders, (
        "Modules exceed the 400-line ceiling and are not grandfathered "
        "(split them -- do NOT add entries to GRANDFATHERED):\n"
        + "\n".join(offenders)
    )


def test_grandfathered_modules_never_grow() -> None:
    """Each grandfathered module stays at or below its recorded ceiling."""
    repo_root = APP_ROOT.parent
    grown = []
    for rel_path, ceiling in GRANDFATHERED.items():
        path = repo_root / rel_path
        assert path.exists(), (
            f"GRANDFATHERED lists {rel_path}, which no longer exists -- "
            "remove the stale entry."
        )
        count = _line_count(path)
        if count > ceiling:
            grown.append(f"{rel_path}: {count} lines (ceiling {ceiling})")
    assert not grown, (
        "Grandfathered modules grew past their recorded ceilings "
        "(shrink them back or split them -- ceilings never go up):\n"
        + "\n".join(grown)
    )


def test_grandfathered_list_stays_honest() -> None:
    """Entries that shrank to MAX_LINES or below must be removed from the list."""
    repo_root = APP_ROOT.parent
    satisfied = [
        f"{rel_path}: {count} lines (now within the {MAX_LINES}-line ceiling)"
        for rel_path, _ceiling in GRANDFATHERED.items()
        if (path := repo_root / rel_path).exists()
        and (count := _line_count(path)) <= MAX_LINES
    ]
    assert not satisfied, (
        "These modules no longer need grandfathering -- delete their entries "
        "from GRANDFATHERED:\n" + "\n".join(satisfied)
    )
