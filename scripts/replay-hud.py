#!/usr/bin/env python3
"""Replay captured HUD frames into a watched decoded.hud.json.

Drives PRSH's HudWatcher exactly the way Project Rio does — by rewriting the
HUD file — so an agent (or a human) can exercise the full HUD pipeline
(parse → side cascade → State → SocketIO) against an isolated server with no
game running. Frames are real `decoded.hud.json` captures in `tests/data/hud/`:

    game1_start  rjb vs MattGree, inning 1, 0-0        (fresh game)
    game1_mid    the same game at inning 9, 6-14       (late live frame)
    game2_start  MattGree vs rjb (sides swapped), new GameID, inning 1
                 → exercises new-game detection (inning reset) + back-to-back

Typical isolated session (see .claude/skills/run-and-verify):

    export PRSH_USER_DATA_DIR=/tmp/prsh-agent/user_data PRSH_PORT=5299 \
           PRSH_NO_BROWSER=1 PRSH_HUD_FILE=/tmp/prsh-agent/decoded.hud.json
    mkdir -p /tmp/prsh-agent
    python main.py &                       # from the repo root; boot takes ~15s
    python scripts/replay-hud.py --target "$PRSH_HUD_FILE"
    curl -s localhost:5299/api/v1/state | python3 -m json.tool

PRSH_HUD_FILE is authoritative (no existence check — the target may not exist
until the first frame is written); without it the server falls back to the
settings hud_path only if that file already exists at boot, then the OS
default. Quote URLs with `?` in zsh.

Then assert on `score.1.*` (players, inning, linescores, side_reason).
"""
import argparse
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "tests" / "data" / "hud"
DEFAULT_SEQUENCE = ["game1_start", "game1_mid", "game2_start"]


def available_frames() -> list[str]:
    return sorted(p.stem for p in FIXTURE_DIR.glob("*.json"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=False,
                    help="Path of the decoded.hud.json the server is watching "
                         "(PRSH_HUD_FILE env override or settings key "
                         "project_rio.hud_path)")
    ap.add_argument("--frames", nargs="*", default=None,
                    help=f"Frame names to replay in order (default: {' '.join(DEFAULT_SEQUENCE)})")
    ap.add_argument("--delay", type=float, default=2.0,
                    help="Seconds between frames (default 2.0 — comfortably past "
                         "the watcher's 300ms debounce)")
    ap.add_argument("--list", action="store_true", help="List available frames and exit")
    args = ap.parse_args()

    if args.list:
        for name in available_frames():
            print(name)
        return 0

    if not args.target:
        ap.error("--target is required (or use --list)")

    frames = args.frames or DEFAULT_SEQUENCE
    missing = [f for f in frames if not (FIXTURE_DIR / f"{f}.json").is_file()]
    if missing:
        print(f"unknown frame(s): {', '.join(missing)}", file=sys.stderr)
        print(f"available: {', '.join(available_frames())}", file=sys.stderr)
        return 1

    target = Path(args.target).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)

    for i, name in enumerate(frames):
        data = (FIXTURE_DIR / f"{name}.json").read_bytes()
        # Write in place (no rename): Project Rio itself rewrites the file, and
        # the watcher keys on modified|added events for this exact filename.
        target.write_bytes(data)
        print(f"[{i + 1}/{len(frames)}] wrote {name} → {target}")
        if i < len(frames) - 1:
            time.sleep(args.delay)
    return 0


if __name__ == "__main__":
    sys.exit(main())
