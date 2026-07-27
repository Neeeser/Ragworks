"""Which databases the worktree cleanup selects — and, more importantly, which it does not.

This is the one piece of logic in the repo whose failure mode is dropping a
database belonging to someone else's live run, so the negative cases carry the
weight here: a sibling worktree that still exists, a shared schema template,
and the dev database itself must all survive a sweep aimed at this worktree.
"""

from __future__ import annotations

from scripts.clean_worktree_databases import _targets

OWNED = ("ragworks_test_040d2c4f_", "ragworks_sandbox_040d2c4f")
LIVE = {"040d2c4f", "1957404d"}


def test_selects_this_worktrees_test_and_sandbox_databases() -> None:
    """The databases this worktree created are the ones it may drop."""
    names = [
        "ragworks_test_040d2c4f_gw0",
        "ragworks_test_040d2c4f_solo",
        "ragworks_sandbox_040d2c4f",
    ]

    assert _targets(names, OWNED, LIVE) == names


def test_keeps_a_live_sibling_worktrees_databases() -> None:
    """A worktree that still exists may be mid-run; its databases are untouchable."""
    names = ["ragworks_test_1957404d_gw0", "ragworks_sandbox_1957404d"]

    assert _targets(names, OWNED, LIVE) == []


def test_selects_databases_whose_worktree_is_gone() -> None:
    """A key in no live worktree is orphaned by definition — nothing can be running in it."""
    names = ["ragworks_test_deadbeef_gw0", "ragworks_sandbox_deadbeef"]

    assert _targets(names, OWNED, LIVE) == names


def test_keeps_the_dev_database_and_unkeyed_names() -> None:
    """A name carrying no worktree key says nothing about ownership, so it stays.

    `ragworks` is the dev database every checkout on the machine shares.
    """
    names = ["ragworks", "ragworks_test", "ragworks_e2e"]

    assert _targets(names, OWNED, LIVE) == []


def test_keeps_schema_templates() -> None:
    """Templates are keyed by schema hash, not worktree, so they are shared.

    `make test-clean-templates` owns those, and only when nothing is running:
    Postgres does not refuse a drop while a template is merely being copied
    from, so sweeping one here would break a neighbouring run mid-`CREATE
    DATABASE … TEMPLATE`.
    """
    names = ["ragworks_tmpl_50da132ad52c", "ragworks_tmpl_dcdd3c33e153"]

    assert _targets(names, OWNED, LIVE) == []


def test_keeps_the_main_checkouts_unsuffixed_sandbox_from_a_worktree() -> None:
    """A linked worktree never drops the main checkout's sandbox database.

    The main checkout's sandbox is `ragworks_sandbox` with no key, so it can
    only ever be selected by the caller that owns it.
    """
    assert _targets(["ragworks_sandbox"], OWNED, LIVE) == []
