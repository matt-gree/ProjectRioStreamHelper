---
name: run-and-verify
description: How to run PRSH's test suites, boot the app for verification, and smoke-test changes — the exact commands, the conftest fixture contract for writing new tests, the isolated-server env overrides (PRSH_USER_DATA_DIR/PRSH_PORT/PRSH_NO_BROWSER/PRSH_HUD_FILE) + HUD replay harness, and per-area verification recipes. Read before running the app, adding tests, or claiming a change is verified.
---

# Run & Verify

## The commands

```bash
./venv/bin/python -m pytest                  # backend suite (~2s)
./venv/bin/python -m pytest tests/unit/rio/test_side_preservation.py -k match   # one test
npm run test:run                             # frontend suite (vitest, one-shot)
npx vitest run src/path/to/file.test.js      # one frontend file
npm run build                                # frontend production build (also a type/import check)
npm run dev                                  # Vite :5173 + FastAPI :5260 together (dev:win on Windows)
npm run build && python main.py              # production-style: everything on :5260
```

- Always `./venv/bin/python -m pytest` / `-m pip` — the `python` binary form,
  not the console scripts, whose baked shebangs break if the repo dir is ever
  moved or renamed.
- Both suites run in CI (`.github/workflows/test.yml`) on PRs and pushes to
  `main`/`2.0.0`. **Both must stay green** — a change isn't done until they are.
- Static assets (dist/, public/) are anchored to the repo root via
  `server/paths.py:app_root()` — the server boots from any CWD. Writable
  files still default to `./user_data` relative to the CWD, so still prefer
  running from the repo root.

## Booting an isolated server (env overrides)

Never verify against the developer's real `./user_data/` — boot an isolated
instance instead. Four env vars (resolved in `server/paths.py`, HUD one in
`server/rio/provider.py`) make this a one-liner:

| Var | Effect |
|---|---|
| `PRSH_USER_DATA_DIR` | Writable dir for state.json/settings.json/participants/branding (created on resolve) |
| `PRSH_PORT` | Server port; wins over settings.json (port-conflict preflight checks the same port) |
| `PRSH_NO_BROWSER` | Suppress the autostart browser tab |
| `PRSH_HUD_FILE` | **Authoritative** decoded.hud.json path — no existence check (the file may not exist until a replay writes it; its parent dir must exist at boot) |

```bash
ISO=/tmp/prsh-agent && mkdir -p "$ISO"
PRSH_USER_DATA_DIR="$ISO/user_data" PRSH_PORT=5299 PRSH_NO_BROWSER=1 \
  PRSH_HUD_FILE="$ISO/decoded.hud.json" ./venv/bin/python main.py &
```

- **Boot takes ~15s** (startup network calls) — poll
  `curl -sf "localhost:5299/api/v1/state"` until it answers; don't fixed-sleep.
- Confirm the HUD watcher bound to your target in the log:
  `[HudWatcher] Watching $ISO/decoded.hud.json`. Without `PRSH_HUD_FILE`, the
  settings `project_rio.hud_path` is honored **only if the file already exists
  at boot**, else it silently falls back to the real OS-default HUD path.
- **Quote URLs containing `?` in zsh** (`curl "localhost:5299/api/v1/state?key=score.1.inning"`)
  or the glob expansion eats them.
- Dev mode is headless (tray/Tk are gated on frozen builds). Kill the server
  when done; the isolated dir is disposable.

### HUD replay harness

`scripts/replay-hud.py` drives the full HUD pipeline (parse → side cascade →
State → SocketIO) with real captured frames from `tests/data/hud/`, exactly
the way Project Rio does — by rewriting the watched file:

```bash
./venv/bin/python scripts/replay-hud.py --target "$ISO/decoded.hud.json"
# default sequence: game1_start (inning 1, 0-0) → game1_mid (inning 9, 6-14)
#                   → game2_start (new GameID, sides swapped → back_to_back)
curl -s "localhost:5299/api/v1/state?key=score.1.inning"       # → 1, then 9, then 1
curl -s "localhost:5299/api/v1/state?key=score.1.side_reason"  # → "back_to_back" after game2
```

- `--frames game1_start` replays a single frame; `--list` shows what's
  available; `--delay` defaults to 2s (past the watcher's 300ms debounce).
- **Poll after each frame, don't fixed-sleep**: a new-game frame makes an
  inline Rio API call (tag-set resolve) before state applies.
- Fixture validity is pinned by `tests/unit/rio/test_hud_fixtures.py` — new
  fixtures must parse through the real pipeline there.

### Real-user_data cautions

- `npm run dev` (and `main.py` without overrides) uses the developer's
  **real `./user_data/`** — prefer read-only checks there; if you must
  mutate, say so in your report.
- Corrupt state recovery: `echo '{}' > user_data/state.json`, or
  `POST /api/v1/scoreboards/reset` for stale board/binding state.

## Writing backend tests (`tests/conftest.py` contract)

Three **autouse** fixtures give every test a clean world — rely on them,
never work around them:

- `mock_socket` — replaces `server.socketio.emit` with an `AsyncMock`
  (returned, so you can assert emitted frames — e.g. SetBatch must emit
  exactly one `v1.state.set_batch`).
- `isolate_user_data` — repoints `State._program_state_out`,
  `State._stream_labels_out`, `Settings._settings_out` at `tmp_path`. A test
  must **never** touch real `user_data/`.
- `reset_singletons` — snapshots/restores State, Settings,
  RioGameDataProvider, StatsTracker, PoolManager class state and gives each
  test a fresh `State.queue`. If you add a new class-level singleton with
  mutable state, **add it to this fixture in the same change**.

Plus the opt-in `set_setting(key, value)` fixture for dotted Settings keys.

Integration tests run **in-process** — no uvicorn/socketio boot:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from server.api import router_v1

app = FastAPI(); app.include_router(router_v1)
client = TestClient(app)
```

Philosophy (TESTING.md): protect silently-regressing logic, test at the seam,
pin overlay/OBS contracts. When a change alters behavior a test encodes,
update the test **in the same commit** — code, tests, and CLAUDE.md must never
disagree.

### Platform gotchas

- CI runs **Linux**; the controller layout (and gc-overlay generally) is
  macOS-only and absent from the layout catalog there. Platform-gate any
  assertion touching it (`platform.system() == "Darwin"`), or it passes
  locally and fails in CI.
- `import main` from the repo root can pick up a submodule's `main.py`
  (rio-visualizer) — use `py_compile` or import `server.server` for sanity
  checks instead.

## Per-area verification recipes

| Changed | Verify with |
|---|---|
| Backend logic (state, match, bindings, cascade) | targeted pytest + full `./venv/bin/python -m pytest` |
| API route | TestClient integration test in `tests/integration/test_api.py`, same style as neighbors |
| Frontend React | `npm run test:run` + `npm run build` (build catches import/JSX errors tests miss) |
| Overlay HTML / `lib/*.js` / theme SVGs | **No automated coverage.** `npm run dev`, open `http://localhost:5260/layout/<group>/<file>.html?scoreboard=1` in a browser, **hard refresh**, check the console; drive state via the UI or `PUT /api/v1/state` |
| Layout catalog metadata | `GET /api/v1/layouts` — type, dims, variants, supportedSettings |
| Settings schema / migrations | pytest (`tests/unit/test_settings_logic.py`) + boot once and check the log for migration output |
| OBS animation behavior (reveal/conceal/intro/shutdown) | Manual only: real OBS, toggle the source eye + cut scenes; watch for the stale-frame flash |

Manual smoke for UI/overlay changes stays worth doing even when suites pass:
`npm run dev`, check the browser console, load an affected layout, hard-refresh.

## Reporting

Report outcomes faithfully: paste the failing output if a suite fails; say
explicitly when something is only build-verified vs browser-verified vs
OBS-verified. "OBS-verified" means a human watched it in OBS — don't claim it
for a browser check.
