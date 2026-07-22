"""The sandbox harness CLI: ``uv run python -m sandbox {up,seed,down,status,logs,list,docs}``.

Environment ordering is the one hard rule here: `.env.sandbox` and the sandbox
backend environment are applied *before* any ``app.*`` import (the db engine
binds ``DATABASE_URL`` at import time), so seeding-related modules are
imported inside the command functions, never at module scope.
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from sandbox import config
from sandbox.keys import load_env_file

CATALOG_RELATIVE_PATH = "docs/sandbox-scenarios.md"


def main(argv: list[str] | None = None) -> None:
    """Parse and dispatch a harness command."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    load_env_file()
    config.apply_backend_env()
    args.func(args)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sandbox", description="Seed named application states for end-to-end testing."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    up = commands.add_parser("up", help="Reset + seed + start backend and frontend.")
    up.add_argument("scenario", help="Scenario name (see `sandbox list`).")
    up.add_argument(
        "--backend-only",
        action="store_true",
        help="Skip the frontend dev server (API-only testing).",
    )
    up.set_defaults(func=_cmd_up)

    seed = commands.add_parser("seed", help="Reset + seed only (no servers).")
    seed.add_argument("scenario", help="Scenario name (see `sandbox list`).")
    seed.set_defaults(func=_cmd_seed)

    down = commands.add_parser("down", help="Stop the sandbox servers.")
    down.set_defaults(func=_cmd_down)

    status = commands.add_parser("status", help="Show server liveness and last handoff.")
    status.set_defaults(func=_cmd_status)

    logs = commands.add_parser("logs", help="Print the tail of a server log.")
    logs.add_argument("server", choices=["backend", "frontend"])
    logs.add_argument("--lines", type=int, default=60)
    logs.set_defaults(func=_cmd_logs)

    scenarios = commands.add_parser("list", help="List scenarios.")
    scenarios.set_defaults(func=_cmd_list)

    docs = commands.add_parser("docs", help=f"Regenerate {CATALOG_RELATIVE_PATH}.")
    docs.set_defaults(func=_cmd_docs)

    flows = commands.add_parser(
        "flows", help="Run saved browser flows (frontend/e2e) against seeded scenarios."
    )
    flows.add_argument(
        "scenarios",
        nargs="*",
        help="Scenario names to run flows for (default: every scenario with flows).",
    )
    flows.add_argument("--list", action="store_true", help="List flows without running.")
    flows.set_defaults(func=_cmd_flows)

    return parser


def _cmd_up(args: argparse.Namespace) -> None:
    from sandbox.harness import servers

    handoff = _reseed(args.scenario)
    servers.start_backend()
    print(f"backend ready on {config.API_BASE_URL}")
    if not args.backend_only:
        servers.start_frontend()
        print(f"frontend ready on {config.FRONTEND_BASE_URL}")
    _print_handoff(handoff, servers_running=True, backend_only=args.backend_only)


def _cmd_seed(args: argparse.Namespace) -> None:
    handoff = _reseed(args.scenario)
    _print_handoff(handoff, servers_running=False, backend_only=False)


def _reseed(scenario_name: str) -> dict[str, Any]:
    """Stop servers, reset the sandbox database, seed, and return the handoff."""
    from sandbox.harness import db, servers

    # Only the backend restarts on reseed — the frontend is stateless across
    # scenarios and restarting `next dev` would cold-compile every route.
    for line in servers.stop_backend():
        print(line)
    db.ensure_server()
    from sandbox.keys import preflight
    from sandbox.registry import get_scenario

    spec = get_scenario(scenario_name)
    preflight(spec.requires)
    print(f"resetting sandbox database and seeding '{spec.name}' …")
    db.reset_database()
    db.init_schema()

    from sqlmodel import Session

    from app.db.engine import engine
    from sandbox.context import SeedContext

    with Session(engine) as session:
        ctx = SeedContext(session=session)
        spec.seed(ctx)
        handoff: dict[str, Any] = {
            "scenario": spec.name,
            "description": spec.description,
            "frontend_url": config.FRONTEND_BASE_URL,
            "backend_url": config.API_BASE_URL,
            "email": config.SANDBOX_EMAIL if ctx.user else None,
            "password": config.SANDBOX_PASSWORD if ctx.user else None,
            "token": ctx.token,
            "browser_login": _browser_login_snippet() if ctx.user else None,
            "links": [
                {"label": label, "url": f"{config.FRONTEND_BASE_URL}{path}"}
                for label, path in ctx.links
            ],
            "facts": list(ctx.facts),
        }
    config.HANDOFF_PATH.write_text(
        json.dumps(handoff, indent=2, default=str), encoding="utf-8"
    )
    return handoff


def _print_handoff(
    handoff: dict[str, Any], *, servers_running: bool, backend_only: bool
) -> None:
    print()
    print(f"scenario: {handoff['scenario']}")
    if servers_running:
        if not backend_only:
            print(f"frontend: {handoff['frontend_url']}")
        print(f"backend:  {handoff['backend_url']}")
    else:
        print("servers:  not started (use `sandbox up`, or start them yourself)")
    if handoff["email"]:
        print(f"login:    {handoff['email']} / {handoff['password']}")
        print(f"token:    {handoff['token']}")
    for link in handoff["links"]:
        print(f"open:     {link['url']}  ({link['label']})")
    for fact in handoff["facts"]:
        print(f"  - {fact}")
    if handoff["email"]:
        print(
            "\nbrowser login without the sign-in form: from any page on the "
            "frontend origin, evaluate this JS once (sets the session cookie "
            "and reloads authenticated):\n  " + str(handoff["browser_login"])
        )
    print(f"(handoff saved to {config.HANDOFF_PATH})")


def _browser_login_snippet() -> str:
    """One-line JS that logs the browser in via the refresh cookie.

    Must run on the frontend origin (CORS allows it); the auth provider picks
    the cookie up on reload, so an agent skips the sign-in form entirely.
    """
    return (
        f'await fetch("{config.API_BASE_URL}/api/auth/token", '
        '{method: "POST", credentials: "include", body: new URLSearchParams('
        f'{{grant_type: "password", username: "{config.SANDBOX_EMAIL}", '
        f'password: "{config.SANDBOX_PASSWORD}", remember_me: "true"}})}}); '
        "location.reload()"
    )


def _cmd_down(_: argparse.Namespace) -> None:
    from sandbox.harness import servers

    lines = servers.stop_all()
    print("\n".join(lines) if lines else "nothing running")


def _cmd_status(_: argparse.Namespace) -> None:
    from sandbox.harness import servers

    for status in servers.statuses():
        state = f"running (pid {status.pid})" if status.running else "stopped"
        print(f"{status.name}: {state} — {status.url}")
    if config.HANDOFF_PATH.exists():
        handoff = json.loads(config.HANDOFF_PATH.read_text(encoding="utf-8"))
        print(f"last seeded scenario: {handoff['scenario']}")


def _cmd_logs(args: argparse.Namespace) -> None:
    from sandbox.harness.servers import BACKEND_LOG, FRONTEND_LOG

    log = BACKEND_LOG if args.server == "backend" else FRONTEND_LOG
    if not log.exists():
        print(f"no log at {log}")
        return
    lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
    print("\n".join(lines[-args.lines :]))


def _cmd_list(_: argparse.Namespace) -> None:
    from sandbox.keys import PROVIDER_ENV_VARS
    from sandbox.registry import all_scenarios

    for spec in all_scenarios():
        needs = (
            " (needs " + ", ".join(PROVIDER_ENV_VARS[p] for p in spec.requires) + ")"
            if spec.requires
            else ""
        )
        print(f"{spec.name}{needs}\n    {spec.description}")


def _cmd_flows(args: argparse.Namespace) -> None:
    """Run saved browser flows scenario by scenario: up → playwright → next.

    Flows live in `frontend/e2e/<scenario>/*.spec.ts`; the directory name is
    the scenario the specs need seeded. Keyed scenarios whose keys are absent
    are skipped by name, mirroring seed preflight.
    """
    import subprocess

    from sandbox.harness import servers
    from sandbox.keys import PROVIDER_ENV_VARS, PreflightError, preflight
    from sandbox.registry import get_scenario

    flows_root = config.REPO_ROOT / "frontend" / "e2e"
    available = sorted(
        entry.name
        for entry in flows_root.iterdir()
        if entry.is_dir() and any(entry.glob("*.spec.ts"))
    )
    if args.list:
        for name in available:
            for spec_file in sorted((flows_root / name).glob("*.spec.ts")):
                print(f"{name}: {spec_file.stem}")
        return
    requested = args.scenarios or available
    results: dict[str, str] = {}
    for name in requested:
        if name not in available:
            raise SystemExit(f"No flows under frontend/e2e/{name}. Available: {available}")
        spec = get_scenario(name)
        try:
            preflight(spec.requires)
        except PreflightError:
            missing = ", ".join(PROVIDER_ENV_VARS[p] for p in spec.requires)
            results[name] = f"skipped (needs {missing})"
            print(f"skipping {name}: missing provider keys ({missing})")
            continue
        _reseed(name)
        servers.start_backend()
        servers.start_frontend(mode="prod")
        print(f"running flows for '{name}' …")
        outcome = subprocess.run(
            ["npx", "playwright", "test", f"e2e/{name}"],
            cwd=config.REPO_ROOT / "frontend",
            check=False,
        )
        results[name] = "passed" if outcome.returncode == 0 else "FAILED"
    for line in servers.stop_all():
        print(line)
    print()
    for name, result in results.items():
        print(f"{name}: {result}")
    if any(result == "FAILED" for result in results.values()):
        raise SystemExit(1)


def _cmd_docs(_: argparse.Namespace) -> None:
    from sandbox.catalog import render_catalog

    target = config.REPO_ROOT / CATALOG_RELATIVE_PATH
    target.write_text(render_catalog(), encoding="utf-8")
    print(f"wrote {target}")
