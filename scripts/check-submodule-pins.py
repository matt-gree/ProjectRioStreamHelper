#!/usr/bin/env python3
"""Fail if a submodule pin is a commit no remote can serve.

PRSH records each submodule as a bare SHA. That SHA is resolvable on the
developer's machine the moment they commit inside the submodule — and nowhere
else until the submodule itself is pushed. Push PRSH first and the pin is a
pointer only one machine can follow: CI dies in `git submodule update` with
"upload-pack: not our ref", a clean clone cannot build, and neither failure
names the submodule commit as the cause.

That is not hypothetical — it is how 2.0.0 spent 2026-07-14 to 08-16 with a
pyrio pin (f4822db) that had never left the laptop, invisible because no CI run
happened in between.

The check: for each submodule, is the pinned SHA reachable from any remote
branch? Fetch first so the answer reflects the remote as it is now, not as it
was cached. Run from a pre-push hook (`.githooks/pre-push`), where the fix is
still one `git -C <path> push` away.

Exit 0 = every pin is fetchable. Exit 1 = at least one is local-only.
"""

from __future__ import annotations

import configparser
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def _git(*args: str, cwd: Path = REPO) -> tuple[int, str]:
    p = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True
    )
    return p.returncode, (p.stdout + p.stderr).strip()


def submodule_paths() -> list[str]:
    gm = REPO / ".gitmodules"
    if not gm.is_file():
        return []
    cp = configparser.ConfigParser()
    cp.read_string(gm.read_text())
    return [
        cp[s]["path"] for s in cp.sections() if cp.has_option(s, "path")
    ]


def pinned_sha(path: str) -> str | None:
    # The pin as it will be pushed — the index, not the submodule's own HEAD,
    # so a staged-but-uncommitted bump is judged too.
    code, out = _git("ls-files", "-s", "--", path)
    if code or not out:
        return None
    parts = out.split()
    return parts[1] if len(parts) > 1 else None


def check(path: str) -> str | None:
    """Return a problem description, or None when the pin is fetchable."""
    sha = pinned_sha(path)
    if sha is None:
        return None  # not a gitlink (deinitialized or removed) — nothing to serve

    sub = REPO / path
    if not (sub / ".git").exists():
        print(f"  ? {path}: not initialized, skipping")
        return None

    # Refresh remote refs so "on a remote branch" means now, not last fetch.
    code, out = _git("fetch", "--quiet", "origin", cwd=sub)
    if code:
        return f"{path}: cannot reach its remote ({out.splitlines()[0] if out else 'fetch failed'})"

    code, out = _git("branch", "-r", "--contains", sha, cwd=sub)
    if code == 0 and out.strip():
        return None

    short = sha[:10]
    return (
        f"{path}: pinned at {short}, which is on NO remote branch.\n"
        f"      Push the submodule first:  git -C {path} push origin HEAD\n"
        f"      Until then CI and every clean clone fail to check this repo out."
    )


def main() -> int:
    paths = submodule_paths()
    if not paths:
        return 0

    print(f"Checking {len(paths)} submodule pin(s) are on a remote…", flush=True)
    problems = [p for p in (check(path) for path in paths) if p]

    if not problems:
        print("  ✓ every submodule pin is fetchable")
        return 0

    # stdout and stderr are separately buffered; without this the failures can
    # surface above the header that explains what was being checked.
    sys.stdout.flush()
    print("\nBLOCKED — submodule pin(s) not on any remote:\n", file=sys.stderr)
    for p in problems:
        print(f"  ✗ {p}\n", file=sys.stderr)
    print(
        "Push the submodule(s) above, then push again. To override anyway "
        "(the pushed commit will not build elsewhere): git push --no-verify",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
