# TESTING.md — PRSH Test Suite Design

> Status: **Phases 0–4 implemented** (only the optional Tier 5 smoke remains).
> This document specifies the regression-protection test suite for
> ProjectRioStreamHelper and tracks its phased rollout (see [Rollout](#rollout)).
>
> **Run it now:**
> ```bash
> ./venv/bin/python -m pytest          # backend (493 tests, ~2.5s)
> npm run test:run                     # frontend (vitest, 88 tests)
> ```

## 1. Goal & philosophy

The app currently ships with **zero automated tests** (CLAUDE.md lists this as a
known limitation; CI only builds releases). The goal is a suite that lets a
contributor refactor `provider.py`, add a layout, or touch the state store and
get a fast, deterministic **"you broke X"** signal before it reaches a stream.

Principles, in priority order:

1. **Protect the logic that silently regresses.** Pure functions and stateful
   machines (side preservation, state diffing, settings migration, stat math)
   are where bugs hide and where a unit test pays for itself many times over.
2. **Fast and deterministic.** No real network, no real filesystem watching, no
   `sleep`-based timing, no running server for the bulk of the suite. The whole
   unit tier should run in a few seconds so it runs on every save.
3. **Test behavior at the seam, not implementation.** Assert on `State` contents
   and emitted SocketIO frames, not on private call counts, so refactors don't
   break tests that should still pass.
4. **Pin the contracts that overlays and OBS depend on.** Layout variant URLs,
   the `?scoreboard=N` default, the `v1.state.set` / `v1.state.set_batch` event
   shapes, and the `score.{N}.*` key names are external contracts. Lock them.
5. **Avoid brittle E2E.** A small smoke layer is worth it; a large Selenium-style
   suite is not, for a single-maintainer project.

Non-goals: 100% coverage, testing Mantine/React internals, testing pyrio
(it's an upstream submodule with its own tests), pixel-diffing overlays.

---

## 2. Tooling

### Backend (Python)

| Tool | Why |
|------|-----|
| `pytest` | Standard runner. |
| `pytest-asyncio` (`asyncio_mode = "auto"`) | Almost every state path is `async`. Auto mode lets `async def test_*` run without per-test decorators. |
| `pytest-cov` | Coverage reporting in CI (report-only, no hard gate initially). |
| `httpx` (already a dep) + `fastapi.testclient` | Exercise API routes in-process. |

Add as a Poetry dev group so they never enter the frozen build:

```toml
# pyproject.toml
[tool.poetry.group.dev.dependencies]
pytest = ">=8.3"
pytest-asyncio = ">=0.24"
pytest-cov = ">=5.0"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["."]    # so tests can `import server` when run from repo root
```

Run: `./venv/bin/python -m pytest` (or `poetry run pytest`).

### Frontend (JS/React)

| Tool | Why |
|------|-----|
| `vitest` | Native Vite integration — reuses `vite.config.js`, no separate build. |
| `jsdom` | DOM for component/store tests. |
| `@testing-library/react` + `@testing-library/user-event` | Behavior-focused component tests. |
| `@testing-library/jest-dom` | Readable DOM matchers. |

```jsonc
// package.json scripts
"test": "vitest",
"test:run": "vitest run",
"test:cov": "vitest run --coverage"
```

```js
// vite.config.js — add:
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: './src/test/setup.js',   // imports @testing-library/jest-dom
  include: ['src/**/*.test.{js,jsx}'],
}
```

> Pure-JS modules (`statCalc.js`, `data/msb.js`) don't need jsdom and run fastest;
> they're the first frontend target.

---

## 3. Test architecture

### Directory layout

```
tests/                              # Python — mirrors server/ package layout
├── conftest.py                     # shared fixtures (singleton reset, socket mock)
├── data/                           # fixture JSON: HUD games, API games, layout HTML
│   ├── hud_game_top1.json
│   ├── hud_game_backtoback.json
│   ├── ongoing_game.json
│   └── completed_game.json
├── unit/
│   ├── utils/test_deep_dict.py
│   ├── utils/test_json.py
│   ├── test_settings_logic.py      # _deep_merge, redaction, migrations
│   ├── test_state.py               # SetBatch/Save/diffing/export
│   ├── rio/test_provider_parse.py  # parse_game_data + resolvers
│   ├── rio/test_side_preservation.py   # the crown jewel
│   ├── rio/test_stats_tracker.py
│   ├── rio/test_rotation.py
│   ├── rio/test_game_pool.py
│   └── api/test_layouts.py         # _derive_type, variant expansion
└── integration/
    ├── test_api_state.py           # FastAPI TestClient
    └── test_api_routes.py

src/                                # JS — co-located *.test.{js,jsx}
├── test/setup.js
├── utils/statCalc.test.js
├── context/store.test.js
├── context/socket.test.jsx
└── routes/layouts/layouts.test.js  # GLOBAL_DESIGN defaults + setting resolution
```

### The singleton-reset problem (most important fixture)

`State`, `Settings`, `RioGameDataProvider`, `StatsTracker`, `RotationManager`,
`OngoingGamePool`, `CompletedGamePool` are class-level singletons. Class state
**leaks between tests** unless reset. An `autouse` fixture in `conftest.py`
snapshots and restores it:

```python
# tests/conftest.py
import copy, asyncio, pytest
from unittest.mock import AsyncMock
import server  # the package exposing the shared `socketio` instance

@pytest.fixture(autouse=True)
def reset_singletons(monkeypatch):
    from server.state import State
    from server.settings import Settings
    from server.rio.provider import RioGameDataProvider as P

    # snapshot
    saved = {
        "state": copy.deepcopy(State.state),
        "last": copy.deepcopy(State.last_state),
        "changed": list(State.changed_keys),
        "settings": copy.deepcopy(Settings.settings),
    }
    State.state, State.last_state, State.changed_keys = {}, {}, []
    State.queue = asyncio.Queue()
    # provider side-preservation flags
    P._prev_player_sides, P._prev_inning = {}, None
    P._sides_swapped = P._user_overridden = False
    P._hud_targets = []
    yield
    State.state = saved["state"]; State.last_state = saved["last"]
    State.changed_keys = saved["changed"]; Settings.settings = saved["settings"]

@pytest.fixture(autouse=True)
def mock_socket(monkeypatch):
    """Capture emitted frames; never touch a real SocketIO server.
    `socketio` is one shared AsyncServer instance imported by State/Settings,
    so patching the instance method covers every caller."""
    emit = AsyncMock()
    monkeypatch.setattr(server.socketio, "emit", emit)
    return emit
```

Settings reads are sync (`Settings.Get`) against the class dict, so tests just
assign `Settings.settings[...]` or use a small `set_settings(**kw)` helper.
File-export is **off by default** (`general.disable_export: True`), so `State`
tests don't hit disk unless they explicitly enable it (then use `tmp_path`).

---

## 4. Prioritized test inventory

Tiers are ordered by **(value × regression-risk) ÷ cost**. Implement top-down.

### Tier 1 — Pure logic (highest ROI, no async, no mocks)

| Target | File | What to lock |
|--------|------|--------------|
| `deep_get/set/unset` | `utils/test_deep_dict.py` | nested create, missing-path default, non-dict traversal returns default, `unset` no-ops on missing, deep `set` builds intermediate dicts. |
| `layouts._derive_type` | `api/test_layouts.py` | `scenes/*`→`scene`, `bracket/*`→`bracket`, trailing-digit strip (`scoreboard1`→`scoreboard`), `teamlogo`→`teamlogo`, empty-stem fallback. |
| `layouts._parse_html_meta` | same | extract `body{width/height}`, parse `<meta overlay-settings>` CSV, return `(None,None,None)` on unreadable/missing. |
| `provider._stadium_slug` / `_resolve_char` / `_resolve_logo` / `_resolve_position` | `rio/test_provider_parse.py` | int-id → name via `LookupDicts`, passthrough strings, `bool`/`None`/`-1`/`""` → `''`, `Inv`/`None` position → `''`. |
| `provider.parse_game_data` | same | full HUD JSON → entrants[2], roster of 9, Top/Bottom→batting side, batter/pitcher resolution, runner-name resolution from roster index, `game_mode`/`tag_set`. |
| `provider._get_msb_team_name` | same | delegates to pyrio `team_name`; bad captain index → `''`. |
| `settings._deep_merge` | `test_settings_logic.py` | loaded overrides defaults, missing default keys preserved, nested dict merge, non-dict-over-dict replacement. |
| `settings.redact_value/redact_settings` | same | secret key (patched fixture; SECRET_KEYS is currently empty) redacted to `***` when set / `""` when empty; non-secret untouched; deep copy (no mutation of input). |
| `statCalc.deriveBatting` | `utils/statCalc.test.js` | AVG/SLG/OBP/OPS/SO%, divide-by-zero → 0, rounding (`.toFixed(3)`). |
| `statCalc.derivePitching` | same | ERA (27×ER/outs), K%, OPP AVG, IP `floor.mod` formatting, zero-outs → 0. |

### Tier 2 — Stateful machines & async core (the regressions that bite)

| Target | File | What to lock |
|--------|------|--------------|
| **`provider._preserve_player_sides`** | `rio/test_side_preservation.py` | Full truth table — see [§5](#5-side-preservation-truth-table). This is the single most valuable test file. |
| `provider._is_new_game` / `_swap_entrants` / `toggle_sides_swapped` | same | `prev None`→new, inning decrease→new; swap reverses entrants **and** scores; toggle sets `_user_overridden`. |
| `State.SetBatch` + `Save` + `_compute_changes` | `test_state.py` | one batch → **one** emitted frame; `changed_keys` tracked; `Save` diffs only tracked keys; no change when value equal; `last_state` updated only for changed paths; snapshot-and-clear race (append during Save lands in next batch). |
| `State.Set/Unset` emit shapes | same | `v1.state.set` payload `{key,value,sid}`, `v1.state.unset` `{key,sid}`, batch `{items,sid}`. |
| `State.Export` (export enabled) | same | with `disable_export=False` + `tmp_path`, set→writes `.txt`, unset→removes, `None`→empty file; string-coerced flag (`"0"`,`"false"`). |
| `Settings.Load` migrations | `test_settings_logic.py` | legacy `server.host` (non-loopback) → `allow_lan=True` then `host` popped; overlay `schema_version<2` strips promoted globals from per-layout dicts, sets v2. (Drive via `tmp_path` settings.json.) |
| `apply_parsed_game_to_state` / `apply_completed_game_to_state` | `rio/test_provider_parse.py` | correct `score.{N}.*` keys, `home_team` 1-vs-2 under swap, completed-game clears live fields, captain in slot 0 + slots 1-8 cleared. |
| `StatsTracker` merge | `rio/test_stats_tracker.py` | API-historical + HUD-current merge, indexed lookup correctness, formulas match `statCalc.js`, `reset_scoreboard`, sides-swapped mapping. |
| `RotationManager` resume gate | `rio/test_rotation.py` | resume only if scoreboard active **and** source==`rotator` **and** `enabled` **and** non-empty `game_ids`; stale enabled flag cleared otherwise. (Mock the API client.) |
| `game_pool._sanitize_row` / `apply_completed_game_dict` | `rio/test_game_pool.py` | pandas Timestamp→ISO, NaN handling, linescore `{"0":[],"1":[]}` split. |

> **Cross-language invariant:** `statCalc.js` "mirrors `stats_tracker.py` formulas"
> (per its own docstring). Add a shared fixture of raw counts → expected derived
> values, asserted in **both** `test_stats_tracker.py` and `statCalc.test.js`, so
> the two implementations can't silently drift.

### Tier 3 — API surface (FastAPI TestClient, in-process)

| Target | What to lock |
|--------|--------------|
| `GET /api/v1/state`, `GET/PUT /state/{key}` | round-trip a key; PUT updates State and emits. |
| `GET /api/v1/layouts` | full variant matrix: scoreboard → 5 `?size=` entries; stats/roster/teamlogo/controller → 2 `?team=` entries; `supportedSettings` present when `<meta>` exists; bracket falls back to 1920×1080. Run against the **real** `public/layout/` tree so adding/breaking a layout is caught. |
| `POST /rio/swap` | toggles `_sides_swapped`, re-applies to state. |
| `GET/PUT /settings/{key}` | secret keys redacted on read; non-secret round-trips. |
| `GET /logs/{name}` | path-traversal guard rejects `../`. |

### Tier 4 — Frontend store & socket

| Target | What to lock |
|--------|--------------|
| `context/store.jsx` | `v1.state.set` and `v1.state.set_batch` both update the store identically; shallow-merge semantics; unset removes keys. |
| `context/socket.jsx` | RAF batching coalesces multiple frames into one store update; **echo filter** (self-`sid` ignored); reconnect requests full state. |
| `routes/layouts/layouts.jsx` | `GLOBAL_DESIGN_DEFAULTS` completeness vs `GLOBAL_DESIGN_KEYS`; setting resolution precedence (per-layout override > global > default); `OVERRIDABLE_GLOBAL_KEYS` honored. |
| A couple of components | `ScoreControls` swap button calls API; `PlayerSlot` renders side 1/2 from store. (Keep light.) |

### Tier 5 — Overlay contract & smoke (optional, low volume)

- `public/layout/lib/overlay-base.js` setting resolution mirrors `layouts.jsx`
  (it's the OBS-side twin). Test with a jsdom harness feeding a fake state.
- One end-to-end smoke: boot the app, hit `/api/v1/state`, load
  `scoreboard.html?scoreboard=1`, push a state frame, assert DOM updates. Gate
  behind a marker so it's opt-in (`pytest -m e2e`).

---

## 5. Side-preservation truth table

`_preserve_player_sides` is the highest-risk logic in the app. Drive it as a
parametrized table. Setup per case: build a `parsed` dict with
`entrants[0][0].rioName = A`, `entrants[1][0].rioName = B`, a given `inning`,
the relevant `Settings`, and pre-set class flags; call; assert `_sides_swapped`,
entrant order, and `_user_overridden`.

| # | Precondition | Pin | Event | Expected |
|---|--------------|-----|-------|----------|
| 1 | `prev_inning=None` | none | first game | no swap; `prev_sides={A:0,B:1}` |
| 2 | new game | A→Team 1, A on side 0 | new | no swap |
| 3 | new game | A→Team 2, A on side 0 | new | **swap** (pin lands A on right) |
| 4 | new game | A→Team 1, A on side 1 | new | **swap** (pin lands A on left) |
| 5 | new game, `prev_sides={A:1,B:0}` | none | new, A now side 0 | **swap** (back-to-back keeps A on right) |
| 6 | new game, `prev_sides={A:0,B:1}` | none | new, same order | no swap |
| 7 | new game | A→Team 1 (matches) | new | pin wins; back-to-back **not** consulted |
| 8 | new game | both flags set from prev game | new | flags reset to `False` before applying |
| 9 | mid-game (`inning` not < prev), `_user_overridden=True`, `_sides_swapped==pin_swap` | pin present | mid | `_user_overridden` cleared |
| 10 | mid-game, `_user_overridden=True`, no pin | none | mid | sides held; no reset |
| 11 | `toggle_sides_swapped()` | — | manual | flips `_sides_swapped`, sets `_user_overridden=True` |

These mirror the rules in CLAUDE.md (§ Player-Side Preservation) — keep the table
and that doc in sync.

---

## 6. CI integration

Implemented as [`.github/workflows/test.yml`](.github/workflows/test.yml) — two
parallel jobs (`backend` / `frontend`), separate from `build-release.yml`, on
every PR and pushes to `main`.

**Dependency install uses pip, not poetry.** `build-release.yml` already installs
with `pip install .` (poetry-core reads `[tool.poetry.dependencies]` at build
time), and `poetry.lock` is not consumed anywhere in CI. So the test job mirrors
that: `pip install .` for the runtime deps + `pip install pytest pytest-asyncio
pytest-cov` for the dev group. This sidesteps poetry-lock consistency entirely —
adding the dev group to `pyproject.toml` does **not** require regenerating the
lock for any workflow to pass.

Gotchas baked into the workflow:

> **`submodules: recursive` is mandatory.** pyrio lives at `server/rio/pyrio`; without
> it `server.rio.pyrio` fails to import and every provider/stats test errors at
> collection. This is the single most likely CI break for this repo.
>
> `RioStatLib` (imported lazily inside `pyrio/stat_file_parser.py`) is **not** a
> declared dependency and isn't installed — that's fine, no test path calls the
> function that imports it. Don't "fix" it by adding it to `pyproject`.

---

## 7. Conventions

- **One behavior per test**, named `test_<unit>_<condition>_<expected>`.
- **Parametrize** truth tables (`@pytest.mark.parametrize`, `it.each`) instead of
  copy-pasting.
- **Fixture data over inline blobs.** Real HUD/API JSON lives in `tests/data/`;
  capture a real `decoded.hud.json` and a real `/games` row (scrubbed) once.
- **Assert on outcomes** (State contents, emitted frame, returned dict), not on
  internal call sequences, except where the *number* of emitted frames is itself
  the contract (SetBatch = 1 frame).
- **No real time/network/FS** in unit tiers. Mock `stats_api`, use `tmp_path`,
  monkeypatch the HUD watcher.
- When a test documents a known-correct edge case, add a one-line `# why` so a
  future reader doesn't "fix" the assertion.

---

## 8. Rollout

| Phase | Deliverable | Outcome |
|-------|-------------|---------|
| **0** ✅ | Tooling: dev deps, `conftest.py` (singleton/socket fixtures), `vite.config` test block, `src/test/setup.js`, `npm`/`pytest` scripts. | `pytest` and `vitest` run green. |
| **1** ✅ | Tier 1 (pure logic, both languages): `deep_dict`, `json`, `layouts`, settings merge/redaction, provider resolvers + `parse_game_data`, `statCalc.js`. | Fast, dependency-free regression net over the math and parsing. **88 py + 9 js tests.** |
| **2** ✅ | Tier 2: `test_side_preservation.py` (table in §5), `test_state.py`, `test_settings_migrations.py`, `test_apply_to_state.py`, `test_stats_tracker.py`, `test_game_pool.py`, `test_rotation.py`. | Core stateful behavior locked. **+74 py tests (162 total).** |
| **3** ✅ | Tier 3 API (`tests/integration/test_api.py`) + Tier 4 (`src/context/store.test.js`, `src/context/socket.test.jsx`, `src/routes/layouts/designConstants.test.js`). | Contracts and frontend wiring covered. **+13 py, +22 js.** |
| **4** ✅ | CI workflow ([`.github/workflows/test.yml`](.github/workflows/test.yml), §6). | Every PR gated; "no backslide" enforced. |

Phases 0–4 are **done** — the suite gates every PR. Later feature work kept
adding tests alongside (matches, bindings, projectors, postgame, theme
compiler…), and a two-round 2026-07-16 coverage-gap pass added the start.gg
parsers, announcements feed, commentary projector, participant registry
import/merge, GameEndWatcher resolver, /scoreboards API, post-game stat-file
gating (`test_postgame_files.py`), the StatsTracker slot lifecycle, and —
on the frontend — the OBS WebSocket layer (`src/context/obs.test.jsx`: the
shutdown-property reconciliation and two-phase-hide contracts, against a
mocked `obs-websocket-js`), the SocketIO unset/settings/config channels, and
the Production element URL-binding rules, bringing the suite to
**493 py + 88 js**. The only remaining planned item is the optional Tier 5
smoke (overlay-base.js resolution + one end-to-end boot), deferred as low-ROI
for a single-maintainer project.

> **Tier 4 note:** `layouts.jsx`'s design constants (`GLOBAL_DESIGN_KEYS`,
> `GLOBAL_DESIGN_DEFAULTS`, `OVERRIDABLE_GLOBAL_KEYS`, `LAYOUT_SETTINGS`) were
> extracted to [`src/routes/layouts/designConstants.js`](src/routes/layouts/designConstants.js)
> so they're testable without importing the 2300-line Mantine component. Behavior
> unchanged; verified with `npm run build`.

### conftest.py fixtures (implemented)

Three autouse fixtures make the singleton-heavy server testable:
- **`mock_socket`** — replaces `server.socketio.emit` with an `AsyncMock`; returned
  so tests assert emitted frames (e.g. SetBatch == 1 frame).
- **`isolate_user_data`** — redirects `State`/`Settings`/`Participants` persisted
  paths into a per-test `tmp_path`; no test touches the real `user_data/`.
- **`reset_singletons`** — snapshots/restores class state for `State`, `Settings`,
  `RioGameDataProvider`, `StatsTracker`, `PoolManager`, `Match._credited_games`,
  `PostGame`, `GameEndWatcher`, `Announcements`, and `Participants` around every
  test. A new class-level singleton with mutable state must be added here in the
  same change that introduces it.

Plus **`set_setting(key, value)`** for dotted-key settings overrides.
