"""Env-file resolution: linked worktrees read the main checkout's keys."""

from __future__ import annotations

from pathlib import Path

from sandbox.config import _resolve_env_file


def _make_linked_worktree(tmp_path: Path, *, gitdir_absolute: bool = True) -> tuple[Path, Path]:
    """A main checkout plus a linked worktree pointing at it, both bare."""
    main = tmp_path / "main"
    admin = main / ".git" / "worktrees" / "wt"
    admin.mkdir(parents=True)
    worktree = tmp_path / "wt"
    worktree.mkdir()
    target = str(admin) if gitdir_absolute else "../main/.git/worktrees/wt"
    (worktree / ".git").write_text(f"gitdir: {target}\n", encoding="utf-8")
    return main, worktree


def test_main_checkout_uses_its_own_file(tmp_path: Path) -> None:
    """A main checkout (`.git` directory) resolves locally, present or not."""
    (tmp_path / ".git").mkdir()
    assert _resolve_env_file(tmp_path) == tmp_path / ".env.sandbox"


def test_worktree_falls_back_to_main_checkouts_file(tmp_path: Path) -> None:
    """A linked worktree without its own file reads the main checkout's."""
    main, worktree = _make_linked_worktree(tmp_path)
    (main / ".env.sandbox").write_text("OPENROUTER_API_KEY=sk\n", encoding="utf-8")
    assert _resolve_env_file(worktree) == main / ".env.sandbox"


def test_worktree_relative_gitdir_falls_back(tmp_path: Path) -> None:
    """`gitdir:` may be relative to the worktree; the fallback still resolves."""
    main, worktree = _make_linked_worktree(tmp_path, gitdir_absolute=False)
    (main / ".env.sandbox").write_text("OPENROUTER_API_KEY=sk\n", encoding="utf-8")
    assert _resolve_env_file(worktree) == (main / ".env.sandbox").resolve()


def test_worktree_local_file_wins(tmp_path: Path) -> None:
    """A worktree's own `.env.sandbox` overrides the main checkout's."""
    main, worktree = _make_linked_worktree(tmp_path)
    (main / ".env.sandbox").write_text("OPENROUTER_API_KEY=main\n", encoding="utf-8")
    (worktree / ".env.sandbox").write_text("OPENROUTER_API_KEY=wt\n", encoding="utf-8")
    assert _resolve_env_file(worktree) == worktree / ".env.sandbox"


def test_worktree_without_main_file_stays_local(tmp_path: Path) -> None:
    """No file anywhere resolves to the local path so callers report its name."""
    _, worktree = _make_linked_worktree(tmp_path)
    assert _resolve_env_file(worktree) == worktree / ".env.sandbox"
