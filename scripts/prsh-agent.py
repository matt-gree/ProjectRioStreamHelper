#!/usr/bin/env python3
"""Drive an isolated PRSH instance from the command line.

Everything an agent needs to boot the app, put it into an interesting state and
read that state back, without touching the developer's real ``user_data/`` and
without spending a browser screenshot on anything that is really just a state
question.

    scripts/prsh-agent.py up                     # boot isolated server, wait for ready
    scripts/prsh-agent.py doctor                 # one-screen health summary + invariants
    scripts/prsh-agent.py doctor --assert        # ...and exit 1 on any violation
    scripts/prsh-agent.py state score.1          # every key under a prefix, one HTTP call
    scripts/prsh-agent.py hud game1_start        # replay a captured frame
    scripts/prsh-agent.py hud --set 'Batter Roster Loc=3'   # poke the live frame
    scripts/prsh-agent.py scenario live-match    # participants + fixture + live game
    scripts/prsh-agent.py down

The isolated instance lives under ``--root`` (default ``/tmp/prsh-agent``) with
its own user_data, port and HUD file, via the four env overrides documented in
``.claude/skills/run-and-verify``. It is disposable — ``up --fresh`` wipes it.

Companion to ``scripts/replay-hud.py`` (which owns the captured frames) and the
``drive-the-app`` skill (which owns the UI map and the browser caveats).
"""
import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "tests" / "data" / "hud"
DEFAULT_ROOT = Path("/tmp/prsh-agent")
DEFAULT_PORT = 5299
BOOT_TIMEOUT = 60.0


# ── plumbing ────────────────────────────────────────────────────────────────

def api(port: int, path: str, method: str = "GET", body=None, params=None):
    """One API call. Returns parsed JSON, or a {'_status': n} dict on HTTP error."""
    url = f"http://127.0.0.1:{port}/api/v1/{path.lstrip('/')}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read().decode(errors="replace")[:300]}
    except urllib.error.URLError as e:
        return {"_status": 0, "_body": str(e.reason)}


def paths(root: Path) -> dict:
    return {
        "user_data": root / "user_data",
        "hud": root / "decoded.hud.json",
        "log": root / "server.log",
        "pid": root / "server.pid",
    }


def is_up(port: int) -> bool:
    r = api(port, "state")
    return isinstance(r, dict) and "_status" not in r


def flatten(obj, prefix=""):
    """State dict → {dotted key: leaf value}. Lists are leaves (they are values
    in this app: linescores, queue orders, roster arrays)."""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, dict):
                out.update(flatten(v, key))
            else:
                out[key] = v
    else:
        out[prefix] = obj
    return out


def short(v, width=72):
    s = v if isinstance(v, str) else json.dumps(v)
    return s if len(s) <= width else s[: width - 1] + "…"


# ── commands ────────────────────────────────────────────────────────────────

def cmd_up(args) -> int:
    root, p = Path(args.root), paths(Path(args.root))
    if is_up(args.port):
        print(f"already up on :{args.port}")
        return 0
    if args.fresh and root.exists():
        subprocess.run(["rm", "-rf", str(root)], check=False)
    root.mkdir(parents=True, exist_ok=True)

    env = {
        **os.environ,
        "PRSH_USER_DATA_DIR": str(p["user_data"]),
        "PRSH_PORT": str(args.port),
        "PRSH_NO_BROWSER": "1",
        "PRSH_HUD_FILE": str(p["hud"]),
    }
    python = REPO_ROOT / "venv" / "bin" / "python"
    log = open(p["log"], "w")
    proc = subprocess.Popen(
        [str(python if python.exists() else sys.executable), "main.py"],
        cwd=str(REPO_ROOT), env=env, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    p["pid"].write_text(str(proc.pid))

    deadline = time.time() + BOOT_TIMEOUT
    while time.time() < deadline:
        if proc.poll() is not None:
            print(f"server exited early (rc={proc.returncode}) — see {p['log']}", file=sys.stderr)
            return 1
        if is_up(args.port):
            print(f"up   http://127.0.0.1:{args.port}   (pid {proc.pid}, log {p['log']})")
            print(f"hud  {p['hud']}")
            return 0
        time.sleep(0.5)
    print(f"timed out after {BOOT_TIMEOUT}s — see {p['log']}", file=sys.stderr)
    return 1


def cmd_down(args) -> int:
    p = paths(Path(args.root))
    if not p["pid"].exists():
        print("no pid file; nothing to stop")
        return 0
    pid = int(p["pid"].read_text().strip())
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        print(f"stopped pid {pid}")
    except ProcessLookupError:
        print(f"pid {pid} already gone")
    p["pid"].unlink(missing_ok=True)
    return 0


def cmd_state(args) -> int:
    """Read state by prefix — ONE HTTP call for any number of keys.

    `?key=` on the REST route fetches a single key, so reading a board costs a
    request per key. Fetching the whole tree once and filtering locally is the
    cheap way to answer "what does this board look like".
    """
    full = api(args.port, "settings" if args.settings else "state")
    if isinstance(full, dict) and "_status" in full:
        print(f"server not reachable on :{args.port}", file=sys.stderr)
        return 1
    flat = flatten(full)
    prefixes = args.prefix or [""]
    hits = {k: v for k, v in flat.items()
            if any(k == pre or k.startswith(pre + ".") or not pre for pre in prefixes)}
    if args.json:
        print(json.dumps(hits, indent=2))
        return 0
    if not hits:
        print("(no keys)")
        return 0
    width = max(len(k) for k in hits)
    for k in sorted(hits):
        print(f"{k:<{width}}  {short(hits[k])}")
    return 0


def cmd_hud(args) -> int:
    """Replay a captured frame, or mutate the frame already on disk.

    `--set` is the difference from replay-hud.py: the captured frames are whole
    games, but most behaviour worth poking (a batter change firing a container
    automation, a score edging up, an inning rolling) is one field moving on the
    frame that is already live. Dotted paths index nested objects.
    """
    p = paths(Path(args.root))
    target = p["hud"]
    target.parent.mkdir(parents=True, exist_ok=True)

    if args.frame:
        src = FIXTURE_DIR / f"{args.frame}.json"
        if not src.is_file():
            avail = ", ".join(sorted(f.stem for f in FIXTURE_DIR.glob("*.json")))
            print(f"unknown frame {args.frame!r}; available: {avail}", file=sys.stderr)
            return 1
        target.write_bytes(src.read_bytes())
        print(f"wrote {args.frame} → {target}")

    if args.set:
        if not target.is_file():
            print(f"{target} does not exist — replay a frame first", file=sys.stderr)
            return 1
        doc = json.loads(target.read_text())
        for pair in args.set:
            if "=" not in pair:
                print(f"--set expects FIELD=VALUE, got {pair!r}", file=sys.stderr)
                return 1
            field, raw = pair.split("=", 1)
            try:
                value = json.loads(raw)          # numbers/bools/JSON pass through
            except json.JSONDecodeError:
                value = raw                      # everything else is a string
            node = doc
            parts = field.split(".")
            for part in parts[:-1]:
                node = node[part]
            node[parts[-1]] = value
            print(f"set {field} = {value!r}")
        target.write_text(json.dumps(doc))

    if not args.frame and not args.set:
        print("nothing to do — pass a frame name and/or --set", file=sys.stderr)
        return 1
    # The watcher debounces 300ms and a new-game frame makes an inline Rio API
    # call before state lands; give the pipeline room before the caller reads.
    time.sleep(args.settle)
    return 0


def cmd_doctor(args) -> int:
    """One screen answering "what is this instance actually showing right now".

    Deliberately reads the same keys a producer reads off the console — board
    orientation and WHY (`side_reason`), identity conflicts, what each container
    is carrying and under whose authority (`production.feed.reason`) — so a
    disagreement between two surfaces shows up here as two lines, not as a
    screenshot an agent has to interpret.
    """
    state = api(args.port, "state")
    settings = api(args.port, "settings")
    if isinstance(state, dict) and "_status" in state:
        print(f"server not reachable on :{args.port}", file=sys.stderr)
        return 1
    flat = flatten(state)

    boards = (settings.get("scoreboards") or {}).get("active") or [1]
    print(f"BOARDS {boards}")
    for sb in boards:
        g = lambda k: flat.get(f"score.{sb}.{k}", None)  # noqa: E731
        n1, n2 = g("player.1.rioName"), g("player.2.rioName")
        t1, t2 = g("player.1.msb_team"), g("player.2.msb_team")
        print(f"  board {sb}: {n1!r} ({t1}) vs {n2!r} ({t2})")
        print(f"    {g('score_left')}-{g('score_right')}  {g('half_inning')} {g('inning')}"
              f"   game={g('game_id')}")
        print(f"    match={g('match')}  side_reason={g('side_reason')!r}"
              f"  conflict={g('match_conflict')}")
        if n1 == "" or n2 == "":
            print("    ^ a side has an EMPTY rioName while the board carries a game —"
                  " a projector blanked it and no feed frame has healed it yet")

    matches = state.get("match") or {}
    print(f"MATCHES {len(matches)}")
    for m, d in sorted(matches.items()):
        pl = d.get("player") or {}
        print(f"  match {m}: {(pl.get('1') or {}).get('rioName')!r} vs "
              f"{(pl.get('2') or {}).get('rioName')!r}  stage={d.get('stage')}"
              f"  series={d.get('series')}  bo{(d.get('format') or {}).get('bestOf')}"
              f"  decided={d.get('decided')}")

    for q in state.get("schedule", {}).get("queues") or []:
        print(f"ORDER {q.get('id')!r} {q.get('title')!r}: {q.get('matches')}")

    feeds = (state.get("production") or {}).get("feed") or {}
    occupants, reasons = feeds.get("container") or {}, feeds.get("reason") or {}
    if occupants:
        print("CONTAINERS")
        for cid in sorted(occupants):
            occ = occupants[cid] or {}
            print(f"  {cid}: {occ.get('element')} (sb{occ.get('scoreboard')}"
                  f"/team{occ.get('team')})  reason={reasons.get(cid)!r}")

    people = api(args.port, "participants")
    if isinstance(people, list):
        print(f"ADDRESS BOOK {len(people)} people")

    # The cross-subsystem checks (server/invariants.py). Always shown — the whole
    # point is that a seam breaking is invisible in any single surface above, so
    # printing them only on request would mean only ever seeing them on purpose.
    report = api(args.port, "invariants")
    if isinstance(report, dict) and "checks" in report:
        found = report.get("violations") or []
        if found:
            print(f"INVARIANTS {len(found)} VIOLATION(S)")
            for v in found:
                print(f"  ✗ {v}")
        else:
            print(f"INVARIANTS ok ({len(report['checks'])} checks)")
        if args.assert_ok and found:
            return 1
    return 0


def cmd_scenario(args) -> int:
    """Put the instance into a known state worth testing against.

    Getting to "a live game with an authored fixture bound to it" by hand is a
    dozen calls; every scenario here is one command so the interesting part of a
    session starts at call two.
    """
    port = args.port
    if not is_up(port):
        print(f"server not up on :{port} — run `up` first", file=sys.stderr)
        return 1

    def hud(frame=None, sets=None, settle=2.0):
        ns = argparse.Namespace(root=args.root, frame=frame, set=sets or [], settle=settle)
        cmd_hud(ns)

    if args.name == "live-match":
        hud("game1_start")
        p1 = api(port, "participants", "POST", {"rioName": "rjb"})
        p2 = api(port, "participants", "POST", {"rioName": "MattGree"})
        m = api(port, "match", "POST")
        mid = (m or {}).get("id", 1)
        api(port, f"match/{mid}", "PUT", {
            "player": {"1": {"participantId": (p1 or {}).get("id"), "rioName": "rjb"},
                       "2": {"participantId": (p2 or {}).get("id"), "rioName": "MattGree"}},
            "format": {"bestOf": 3},
        })
        api(port, f"scoreboards/1/match", "PUT", {"match": mid})
        hud("game1_mid")
        print(f"live-match: match {mid} (Bo3) bound to board 1, game live at inning 9")

    elif args.name == "two-boards":
        api(port, "scoreboards", "POST")
        hud("game1_start")
        print("two-boards: boards 1 and 2 active, board 1 on the HUD feed")

    elif args.name == "reset":
        api(port, "scoreboards/reset", "POST")
        print("reset: boards/bindings/matches cleared")

    else:
        print(f"unknown scenario {args.name!r}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(DEFAULT_ROOT),
                    help=f"isolated instance dir (default {DEFAULT_ROOT})")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT,
                    help=f"server port (default {DEFAULT_PORT})")
    sub = ap.add_subparsers(dest="cmd", required=True)

    up = sub.add_parser("up", help="boot the isolated server and wait for ready")
    up.add_argument("--fresh", action="store_true", help="wipe the instance dir first")
    up.set_defaults(func=cmd_up)

    sub.add_parser("down", help="stop the isolated server").set_defaults(func=cmd_down)

    st = sub.add_parser("state", help="dump state keys under a prefix (one HTTP call)")
    st.add_argument("prefix", nargs="*", help="dotted prefixes, e.g. score.1 match production.feed")
    st.add_argument("--settings", action="store_true", help="read Settings instead of State")
    st.add_argument("--json", action="store_true")
    st.set_defaults(func=cmd_state)

    hd = sub.add_parser("hud", help="replay a captured frame and/or poke fields on it")
    hd.add_argument("frame", nargs="?", help="frame name (see replay-hud.py --list)")
    hd.add_argument("--set", action="append", metavar="FIELD=VALUE",
                    help="mutate the frame on disk; dotted paths index nested objects")
    hd.add_argument("--settle", type=float, default=2.0, help="seconds to wait after writing")
    hd.set_defaults(func=cmd_hud)

    dr = sub.add_parser("doctor", help="one-screen summary of boards/matches/feeds + invariants")
    dr.add_argument("--assert", dest="assert_ok", action="store_true",
                    help="exit 1 if any cross-subsystem invariant is violated")
    dr.set_defaults(func=cmd_doctor)

    sc = sub.add_parser("scenario", help="drive the instance to a known state")
    sc.add_argument("name", choices=["live-match", "two-boards", "reset"])
    sc.set_defaults(func=cmd_scenario)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
