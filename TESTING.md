# TESTING.md — PRSH Test Suite

What the suite protects, how it is laid out, and the rules that keep it
trustworthy. The *how-to* (commands, isolated boots, fixture usage, per-area
verification recipes) lives in [`.claude/skills/run-and-verify/SKILL.md`](.claude/skills/run-and-verify/SKILL.md);
this file is the design it follows.

```bash
./venv/bin/python -m pytest          # backend  (~1,540 tests, ~13s)
npm run test:run                     # frontend (vitest, ~1,510 tests / 76 files, ~25s)
npm run vite:lint                    # ESLint, --max-warnings 0
```

Both suites run in CI ([`.github/workflows/test.yml`](.github/workflows/test.yml))
on every PR and on pushes to `main` / `2.0.0`, and **both must stay green**.

> History: this file began (July 2026) as a phased rollout plan for an app with
> no tests. Every phase shipped; the plan is retired and this is the suite as it
> stands. The optional end-to-end smoke tier was never built — driving a real
> instance is `scripts/prsh-agent.py` + the `drive-the-app` skill instead.

---

## 1. Philosophy

In priority order:

1. **Protect the logic that silently regresses.** The side cascade, series
   crediting, projector key ownership, state diffing, settings migrations and
   stat formatting are where a bug produces a plausible-looking broadcast with
   the wrong thing on it. A unit test pays for itself many times over there.
2. **Fast and deterministic.** No real network, no filesystem watching, no
   `sleep`-based timing, no running server. The whole pair runs in well under a
   minute, so there is no reason to run a subset and stop.
3. **Test behavior at the seam, not the implementation.** Assert on `State`
   contents, emitted SocketIO frames and rendered DOM — not on private call
   counts — so a refactor that keeps the behavior keeps the tests. The
   exception is where the *count* is the contract (a `SetBatch` is one frame).
4. **Pin the external contracts.** Layout URLs and variants, the `?scoreboard=N`
   default, the `v1.state.set` / `set_batch` frame shapes (both `items` and
   `augmented`), `score.{N}.*` key names, and theme slot/modifier grammar are
   read by OBS sources and design packages PRSH does not control.
5. **One fact, one statement — and a test where it has to live twice.** When a
   rule must exist in both runtimes, the test compares them (§4).
6. **Code, tests and CLAUDE.md never disagree.** A change to behavior a test
   encodes updates the test in the same commit.

Non-goals: coverage targets, testing React/Radix internals, testing pyrio (it is
a submodule with its own tests), pixel-diffing overlays.

---

## 2. Layout

### Backend — `tests/`

```
tests/
├── conftest.py            # autouse isolation + opt-in helpers (§3)
├── data/hud/              # captured decoded.hud.json frames (game1_start, game1_mid, game2_start)
├── data/design/           # a real designer export for the theme compiler
├── fixtures/              # cross-runtime case tables (board_lifecycle.json)
├── unit/
│   ├── rio/               # provider parsing, apply-to-state, side cascade,
│   │                      #   game end, pools, rotation, stats tracker, state completeness
│   ├── api/               # layouts catalog, match binding / series cap / start.gg,
│   │                      #   schedule (queues, next-up, waiting reasons), game modes
│   ├── startgg/           # parsers, auto-fill
│   └── test_*.py          # state, settings + migrations, participants + books,
│                          #   projectors, postgame, automations, design packages,
│                          #   theme compiler + Figma round trip, parity pins
└── integration/
    ├── test_api.py              # routes over TestClient
    ├── test_scoreboards_api.py  # add / remove / reset, per-board key teardown vs id re-use
    ├── test_branding_presets.py
    └── test_invariants.py       # cross-model rules (§5)
```

Integration tests run **in-process** over `fastapi.testclient.TestClient` and
`router_v1` — no uvicorn, no SocketIO boot.

### Frontend — co-located

Tests sit next to the module they cover (`rack.jsx` → `rack.test.jsx`), never in
a mirror tree. The bulk is in `src/routes/production/` (console, stage panels,
kit) and `src/routes/layouts/` (the Design tab).

The one exception is the **overlay runtime** under `public/layout/lib/` (mounts,
`mount-utils`, `rio-data`, port colours, type roles): its tests are in
`tests/overlay/`, because everything under `public/` is served as-is and a test
file there would be a page anyone could load. Those modules are plain ES modules
and import straight into vitest.
Config is the `test:` block in `vite.config.js` (jsdom, globals, setup at
`src/test/setup.js`).

---

## 3. Isolation

### Backend: the conftest contract

Three **autouse** fixtures give every test a clean world:

- **`mock_socket`** — `server.socketio.emit` becomes an `AsyncMock`, returned so
  a test can assert the frames emitted.
- **`isolate_user_data`** — every persisted path (state, settings, stream
  labels, participants) is redirected into the test's `tmp_path`. **No test may
  touch the real `user_data/`.**
- **`reset_singletons`** — snapshots and restores the class-level state of every
  singleton: `State`, `Settings`, `RioGameDataProvider`, `StatsTracker`,
  `PoolManager`, the ongoing/completed game pools, `PostGame`,
  `StatFileWatcher`, `GameEndWatcher`, `Automations`, `Announcements`,
  `Participants` (+ books) and `StartGGProvider`. **A new singleton with mutable
  class state is added here in the same change that introduces it** — a missing
  one leaks across tests as an order-dependent failure.

Opt-in helpers: `set_setting(key, value)` (bumps `Settings.revision` so cached
consumers see it), `rig(*ids)` (the default rig is one board and bind routes
404 anything outside it), `pin_player(rio_name, side)` (writes the address-book
row the cascade's `pin` layer reads — a pin is `prefs.side` on a person, never a
setting).

### Frontend: seed the stores, don't mock the data layer

Zustand stores are the seam: a test seeds `useStateStore` / `useSettingsStore` /
`useStagingStore` directly and renders the real component. Reset every store a
component reads in `beforeEach` — they are module singletons.

`vi.mock` is for **boundaries** only. The suite has eight, and every one stands
in for something the test is not about: two external clients
(`socket.io-client`, `obs-websocket-js`), a third-party widget
(`react-colorful`), the toast (×2), and three context modules' REST writers —
partial mocks that keep the real store and replace only the call to the server.

---

## 4. Cross-runtime pins

Several rules must exist in Python and JavaScript. Where the two cannot share
code, a test pins them together — each fails the moment one side changes alone.

| Fact | Pinned by |
|------|-----------|
| Scoreboard sizes and canvases (`theme_contracts.CONTRACTS`) | `tests/unit/test_size_dims_parity.py` |
| Which elements come in per-side pairs (`perSide` / `_TEAM_VARIANTS`) | `tests/unit/test_per_side_parity.py` |
| Catalog display names | `tests/unit/test_catalog_names_parity.py` |
| A board's lifecycle (`lifecycle_of` / `boardLifecycle`) | one case table, `tests/fixtures/board_lifecycle.json`, read by `test_board_lifecycle_parity.py` **and** `src/routes/production/board-lifecycle.test.js` — a behaviour, so parity is shared cases rather than parsing one language from the other |
| A layout's `<meta>` whitelist vs `LAYOUT_SETTINGS` | `src/routes/production/stage/eventheader.test.jsx` and the layouts tests |
| Theme slot and modifier grammar survives the Figma round trip | `tests/unit/test_figma_template.py` (slot counts per name; every `data-*` a mount reads is in `_MODIFIERS`) |
| Every layout declares a sample bundle | `tests/overlay/overlay-sample.test.js` |

Where one runtime can **import** the other's module, it does instead of pinning
a copy: the console imports `container-members.js`, `spotlight-intent.js`,
`match-format.js` and `scheduleRows` from the overlay runtime.

---

## 5. The invariant layer

Every subsystem is unit-tested and correct alone; the bugs no module's tests can
see are the rules **between** models — a projector and a feed sharing
`score.{N}.player.{T}.*`, a container's feed and its roster, `schedule.queue`
and the orders it projects. They are written once in `server/invariants.py` and
run from three places off that one list: `tests/integration/test_invariants.py`,
`GET /api/v1/invariants`, and `scripts/prsh-agent.py doctor --assert`.

A workflow test drives the routes a producer's clicks go through, then asserts
the invariants hold. Seed a live board through the provider (not a hand-written
`SetBatch`), or the re-settle path silently no-ops and the test passes for the
wrong reason. Each check has a test that watches it fail.

---

## 6. CI

`.github/workflows/test.yml` runs two parallel jobs, separate from
`build-release.yml`:

- **Backend** — `pip install .` (the same install path the release build uses;
  `poetry.lock` is not consumed in CI) plus `pytest pytest-asyncio pytest-cov`,
  then `pytest --cov=server`.
- **Frontend** — `npm ci`, lint, `vitest run`.

Gotchas:

- **`submodules: recursive` is mandatory.** pyrio lives at `server/rio/pyrio`;
  without it every provider and stats test errors at collection.
- **Push a submodule before the PRSH commit that pins it**, or CI dies in
  `git submodule update` with `upload-pack: not our ref` (see CLAUDE.md → Git).
- `RioStatLib` (imported lazily inside pyrio) is not a declared dependency and
  no test path reaches it. Don't "fix" that by adding it to `pyproject`.

---

## 7. Conventions

- **One behavior per test**, named for the behavior. Where a test documents a
  known-correct edge case, a one-line comment says why, so a later reader does
  not "fix" the assertion.
- **Parametrize truth tables** (`@pytest.mark.parametrize`, `it.each`) rather
  than copy-pasting — the side cascade (`tests/unit/rio/test_side_preservation.py`)
  is the model.
- **Real captured data over inline blobs** — HUD frames in `tests/data/hud/`,
  shared by the tests and `scripts/replay-hud.py`.
- **Stub a browser measurement the way a browser answers it.** A detached SVG
  node measures as zero rather than throwing; a stub that measured it anyway
  would make a test that cannot fail (see the ticker mount's bind-after-append
  test).
- **A test that passes with the fix reverted is not a test of the fix** — check
  that it fails first.
