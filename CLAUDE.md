# CLAUDE.md — ProjectRioStreamHelper (PRSH)

## Project Overview

A web-based tournament stream overlay manager for **Mario Superstar Baseball (MSB)** via the Project Rio mod. Forked from TournamentStreamHelper (originally Qt/PySide6) and rebuilt as a single-game web app.

**Server:** `server/` — FastAPI + SocketIO on configurable port (default 5260).
**Frontend:** `src/` — React SPA served by FastAPI in production, Vite dev server in development.
**Builds:** PyInstaller (`PRSH.spec`) → standalone macOS `.app` / Windows `.exe`; Inno Setup (`installer/PRSH.iss`) → Windows installer.
**Submodules:** `server/rio/pyrio` (MSB data + stat parsing), `gc-overlay/` (controller overlay, macOS), `rio-visualizer/` (hit-trajectory simulation).

See [README.md](README.md) for end-user docs and [TESTING.md](TESTING.md) for the test-suite design.

## Agent Quickstart

```bash
./venv/bin/python -m pytest        # backend suite (~2s)
npm run test:run                   # frontend suite (vitest)
npm run vite:lint                  # ESLint — src/ + public/layout/lib/ (flat config: eslint.config.js)
npm run build                      # frontend production build
npm run dev                        # Vite (5173) + FastAPI (5260) together
```

- `python main.py` from a source checkout runs the server **headless** (tray/Tk UI is gated on frozen builds, not dev mode). ⚠️ With no overrides it uses the real `./user_data/` — for verification, boot an **isolated instance** via `PRSH_USER_DATA_DIR` + `PRSH_PORT` + `PRSH_NO_BROWSER` + `PRSH_HUD_FILE`, and drive the HUD pipeline with `scripts/replay-hud.py` (see the `run-and-verify` skill).
- Layout HTML and `public/layout/lib/*.js` are static — no build step, but OBS/browser caches them: **hard refresh** (Cmd/Ctrl+Shift+R) after editing.
- CI (`.github/workflows/test.yml`) runs both suites on PRs and pushes to `main`/`2.0.0`.
- **Deep-dive skills** in `.claude/skills/` — this file is the map; the skills hold the depth. Load the matching one before working in its area: `state-keys-and-projectors` (State contract, namespaces, projector pattern), `match-binding-lifecycle` (fixtures, bindings, side cascade, game end, start.gg), `overlay-authoring` (layouts, mounts, themes, OBS behavior), `design-package-authoring` (theme SVG packages, converting designer exports), `production-console-contract` (Production rack/stage/rail + element contract), `controller-overlay` (gc-overlay subprocess + per-side follow), `run-and-verify` (tests, booting, smoke recipes).

---

## Glossary

These terms have specific meanings in this codebase. Use them precisely; correct an agent that drifts.

| Term | Meaning |
|------|---------|
| **Scoreboard / Board** | One entry under `score.{N}` in state, listed in `scoreboards.active`. N ≥ 1; multiple may be active simultaneously. At least one always remains. Its console home is a **board desk** (`desk:board:{N}`) — added and removed from the rack's own `BOARDS` section, renamed on its stage panel. |
| **Binding** | What fills a scoreboard: `scoreboards.binding.{N}` in **Settings** — a `pool` (membership) + `playback` (how the pool is shown) + `stats_tag`. Defined in `server/bindings.py`. There is **no "source" enum** — "manual" is just the empty binding (single playback, empty pool). |
| **Pool** | A binding's game membership: `filters` (search chips: tag/username/vs_username/limit), `scope` (`live \| completed \| both`), `pinned` (always in), `excluded` (never in), `refresh_interval` (0 = static). |
| **Playback** | How a board presents its pool: `mode: single \| rotate`, `gameId` (single: null = auto-follow), `interval` + `running` (rotate). |
| **Transport** | HUD file vs API — **derived, never user-picked**: board 1 carries the local HUD iff the global `project_rio.hud_enabled` toggle is on; every other board is API. `bindings.transport(sb)`. |
| **Side** | `1 = left`, `2 = right`. Used everywhere PRSH state references team position. Never use "away/home" in app vocabulary — Project Rio uses those internally but we translate. |
| **Team** | Synonymous with Side in state (`.player.{T}` where T∈{1,2}). |
| **Match** | The fixture object above scoreboards: `match.{M}` in state (participants per side, captain, format, series, stage `draft \| live \| post`). A board binds to it via `score.{N}.match = M` (int id, never a round-name string). |
| **Projector** | The resolve-by-copy pattern: a model (Match, Commentary, PlayerPlates, PostGame) resolves its records against the participant registry and copies the result into the state keys overlays read. Deterministic: writes the full key set (value or `""`) so unbinding blanks exactly what it set. |
| **Placement** | A Production rack row: one source, in one scene — `{element}:{board}@{scene}`. The console's row identity; see `src/routes/production/placements.js`. |
| **Element** | A Production-page broadcast unit. **Direct** elements own a dedicated source; **fed** elements are pushed content into a container. Related: **dedicated source** / **feed** — see `src/routes/production/elements.js`. |
| **Container** | One OBS browser source that hosts whichever of its **members** is fed to it. Producer-built: `settings.production.container_defs.{id}` = name + native size + member roster, all rendered by one shell (`/layout/shared/container.html?container={id}`). Membership lives on the container and is **exclusive** — `production.feed.container.{id}` holds exactly one occupant, so sharing a container is what "these never appear together" means. Container-scoped members are the exception (see **Member**). |
| **Member** | An element on a container's roster. Must fit the container (same size or smaller — smaller ones center, nothing ever scales). A **container-scoped** member (`containerScoped`: Roster, Stat Card) has no content of its own — it draws whoever the container's scope has on the field — so it is the one kind that may sit on several rosters at once. |
| **Automation** (container) | A rule that makes a container feed itself: `trigger` (a state key changes) · `guard` (the content resolves) · `action` (show a member) · `dwell` · return to **resting**. Stored in `settings.production.automations.{id}`, run by `server/automations.py` **inside the state-write path**. Precedence **manual > rule > resting**, mirrored to `production.feed.reason.{container}`. Not to be confused with an **Announcement**-style notification, and unrelated to *Rotation*. |
| **Resting occupant** | What a container shows when nothing else is up — `container_defs.{id}.resting`. The state a dwell returns to and the boot state. Absent = empty (transparent), which is right for a container that only ever holds pushed content. |
| **Container scope** | `container_defs.{id}.scope` = `{scoreboard, team}` — a container's frame of reference. Resolves `{sb}` in a rule's trigger and picks the side of the content the engine feeds; a mirrored pair is two scoped containers running one canned rule. |
| **Layout** | An HTML file under `public/layout/`, served as an OBS Browser Source. Declares its style contract via `<meta name="overlay-settings">` and its native size via `body { width/height }`. |
| **Layout type** | Derived from filename + group folder (`server/api/v1/layouts.py`). Drives `?size=` / `?team=` variant expansion. |
| **Scene** | An **OBS** scene — the Production rack's grouping axis. PRSH has no scene *Layout*: the "full scene" group (a 1920×1080 layout that was the entire stream canvas) was dropped, because a canvas built from placed elements is what the console is for. |
| **Overlay** | Generic OBS Browser Source terminology. Not PRSH-specific; do not use as a synonym for any of the terms above. |
| **Sample bundle** | A Layout's canned state fragment under `public/layout/preview/*_sample.json`, declared via `OverlayBase.init({ sample })`. Every Layout has one. Keys carry `{sb}`/`{team}` tokens resolved from the page URL. |
| **Demo mode** | State `production.sample` — the app-wide switch that makes every overlay render its sample bundle instead of live state, for building OBS scenes with no game running. Global, never self-enabling, guarded by an app-wide banner. |
| **Size variant** | `?size=s\|m\|l` query param, scoreboard layouts only (`xs`/`xl` retired with the SVG conversion; legacy URLs fall back to `l`). |
| **Team variant** | `?team=1\|2` query param. Applies to stats, roster, teamlogo, controller, playername. |
| **Rotation / Rotating** | A board whose playback mode is `rotate`, cycling its pool at an interval. Managed by `PoolManager` (`server/rio/rotation.py`). No other meaning — there is no "player rotation" concept. |
| **Rotator (layout group)** | `public/layout/rotator/*.html` — standalone layouts (e.g. the results ticker) that display rotating content. Distinct from rotate playback. |
| **Design package / Theme** | A swappable SVG theme set under `public/design/{package}/` (default, classic, + user packages in `user_data`). Elements mount theme SVGs via `svg-theme-engine.js` data-slot binding. |
| **HUD game** | Game data sourced from the local `decoded.hud.json` file. |
| **API game** | Game data sourced from `https://api.projectrio.app/`. |
| **Participant / Address Book** | The participant registry (`server/participants.py`, REST-only, `participants.json`): rio name → display identity (name, team, pronouns, socials). The join point for Match, Commentary, PlayerPlates, Matchup. |
| **Pinned player** | A name in settings that PRSH forces onto a chosen Side at the start of each new game. Configured in Settings → Project Rio. |
| **Stream labels** | Per-key `.txt` mirror of state under `user_data/stream_labels/`. Off by default. Intended for OBS Text Sources. |
| **Branding** | Tournament logo + merch assets uploaded by the user to `user_data/branding/`, served at `/branding/`. |
| **MSB assets** | User-supplied image pack at `user_data/game_assets/msb/{characterIcons,teamLogos,gameIcons}`. Validated against pyrio's canonical filename lists. PRSH does not ship these (Nintendo IP). |
| **Announcement** | Notification surfaced from GitHub: either an "Update available" synthesized from the Releases API, or an entry in `announcements.json` on the repo's `announcements` branch. |

---

## Architecture

### Core Data Flow

```
Project Rio game ─→ decoded.hud.json ─→ HudWatcher ─→ RioGameDataProvider ──┐
Project Rio API ─→ Ongoing/CompletedGamePool ─→ PoolManager (bindings) ─────┤
start.gg ─→ StartGGProvider ─→ Match (fixture) ─┐                           │
Participants registry ──────────────────────────┤                           ▼
Commentary / PlayerPlates / Matchup / Schedule ─┴─ projectors ──→ State.SetBatch()
Post-game stat files ─→ PostGame capture ────────────────────────────↗      │
                                                                            ▼
                                              SocketIO (v1.state.set/set_batch) + v1.action bus
                                                            │
                                              React UI + OBS overlays (+ optional stream_labels/)
```

Two write paths into `score.{N}.*` meet at the board: the **live feed** (HUD/API game data) and the **Match projector** (authored fixture data). The side cascade (below) and the projector's key ownership rules keep them from fighting.

In **frozen builds**, `user_data/` lives under the per-user writable root resolved by `server/paths.py` (e.g. `~/Library/Application Support/PRSH/user_data/` on macOS, `%LOCALAPPDATA%\PRSH\user_data\` on Windows). In **dev mode** it's `./user_data/` next to the repo.

### Singleton Pattern

The server uses class-level singletons with `@classmethod` methods, state shared via class variables — `State`, `Settings`/`Config`, `RioGameDataProvider`, `StatsTracker`, `PoolManager`, `Match`, `Participants`, the element models, and the watchers all follow this shape. Match it when adding a new server-side model; don't introduce instance-based services alongside it.

---

## State — The Central Nervous System

Every change flows through `State.Set(key, value)` or `State.SetBatch(entries)`. This:
1. Updates the in-memory `state` dict.
2. Tracks changed keys in `changed_keys`.
3. On `Save()`: compares only tracked keys against `last_state` (no full-state diff).
4. Exports changed keys as individual `.txt` files (if enabled).
5. Broadcasts via SocketIO (`v1.state.set` or `v1.state.set_batch`).

**Key patterns:**
- `State.Set("score.1.player.1.rioName", "Player1")` — single key.
- `State.SetBatch([(k, v), ...])` — multiple keys; **always prefer this when writing more than one key**.
- `State.Save()` — diff from tracked keys only.
- File export off by default (`general.disable_export: True`).

**Scoreboard config lives in Settings, not State.** `scoreboards.active`, `scoreboards.aliases`, and `scoreboards.binding.{N}` are **Settings** keys. Legacy `scoreboards.sources` / flat `scoreboards.rotation` settings are read-only migration fallbacks — never write them.

> Deep dive: `.claude/skills/state-keys-and-projectors/SKILL.md` — the full state-key namespace map, the Settings-vs-State split, and the projector pattern.

---

## Scoreboards & Bindings

- Each board's binding is independent; boards can share pool contents.
- **Transport is derived**: board 1 carries the local HUD iff `project_rio.hud_enabled`. There is no per-board source selector — don't add one.
- Boards can be renamed (alias) and removed; at least one always remains. Layouts bind via `?scoreboard=N` — **a missing param defaults to board 1**, which is safe because board 1 always exists.
- `POST /scoreboards/reset` is the escape hatch that clears stale board/binding state.

### Player-Side Cascade (who sits left/right)

Project Rio randomly assigns away/home each game. `_decide()` in `server/rio/provider.py` resolves each board's orientation with precedence:

**manual > match > pin > back_to_back > none**

The deciding layer is mirrored to `score.{N}.side_reason`. Manual scope is the current game only. Tests encoding this live in `tests/unit/rio/test_side_preservation.py` — change behavior and tests in the same commit.

### Match Model & Projectors

- `apply_startgg_set` in `server/api/v1/match.py` is the **only** set→match path. There is no direct set→score path.
- **A match fills exactly one board**, and `bind_board` (`server/api/v1/match.py`) is the only writer of `score.{N}.match` — binding a match another board holds *moves* it, vacating and blanking the old holder. Never write that key directly; the invariant used to live in a click handler and every other caller missed it.
- **The match owns the series** (games won within the Bo format); boards own only their live game.
- **Identity gate:** if live players don't match the bound fixture, `score.{N}.match_conflict` raises the app-wide banner; a decided-mismatch auto-retires the binding.
- **Projector rules** (Match, Commentary, PlayerPlates, PostGame all follow this shape — reuse it, don't invent a new one): resolve records against the Participants registry, write the *full* owned key set via `SetBatch` (value or `""`), wrap `project_all()` startup hooks in try/except so a bad record never blocks boot. A captain-less match projection must never blank a live HUD captain.

> Deep dive: `.claude/skills/match-binding-lifecycle/SKILL.md` — binding schema, fixture shape, the full cascade table, identity gate, game-end detection, start.gg.

---

## Production Tab & Elements

The Production tab is a **console with three surfaces** — rack (monitor + select), stage (work on the one selected thing), quick rail (producer-pinned cards). Every element declares the same contract (registration · quick face · stage body) and all three surfaces compose from the shared row kit. **Read `.claude/skills/production-console-contract/SKILL.md` before touching `src/routes/production/`.**

- **OBS scenes are the rack's grouping axis**, and rows are **placements** (`src/routes/production/placements.js`): one row per source per scene, keyed `{element}:{board}@{scene}`. The rack lists only what is really in a scene — derivation runs source → row — and the **+** in each scene header (`addsource.jsx`) is how a source is created. There is no "phase" concept; it was removed in favour of the producer's own scene list.

- **Containers are producer-built** (`src/routes/production/containers.js`): a definition in Settings (name · native size · member roster), one generic shell rendering all of them. **Membership lives on the container and is exclusive** — the roster *is* the relationship, so `settings.production.containers.{elementId}` and `defaultContainerFor` are gone; don't reintroduce a per-element "feed into" target. The one exception is a **container-scoped** member (`containerScoped`), which is *added* rather than moved: exclusivity answers "where does a push land", and a member with no content of its own has nothing to land — which is what makes a mirrored pair (two scoped containers, same members, one rule) buildable in the console. A member must fit the container (smaller ones center; **PRSH has no scaling system** — OBS does placement). Built from the Add picker's **+ New**, edited on the container's own stage panel.

- **A container can feed itself** (`server/automations.py` + `src/routes/production/automations.js`): a rule watches a state key and shows one of the container's members for a dwell, then returns to its **resting** occupant. The engine is a **`State.hooks` write-path hook**, so a rule's feed write rides the *same* `SetBatch` as the HUD change that triggered it — never add a polling loop for this. Precedence **manual > rule > resting** mirrored to `production.feed.reason.{container}` (modelled on `side_reason`); a producer Push suspends the rules and **clearing the feed is what hands the container back** — no separate Resume verb. Rules are only created from the **quick-add library** (templates in `automations.js`), edited on the container's stage panel (`stage/automation.jsx`); there is no free-text trigger authoring.

- OBS control runs **browser-side** (`src/context/obs.jsx`, localhost:4455) — this reaches the producer's OBS even in dual-machine setups. Don't move it server-side.
- **OBS is the control surface, not the content pipeline.** With no connection the rack swaps its scene sections for a **catalog tier** (`catalogPlacements`/`useConsoleOffline` in `placements.js`): every element and container, in the same sourceless placement shape, so the stage, previews, container rosters and feeds all keep working. The strip's Bind becomes **Copy URL**, and the Add picker opens scene-less for Copy URL + **+ New** container. Don't reintroduce a surface that dies without OBS.
- **Selection, rail pins and expanded scenes are browser-local** (`usePersistentState`, `prsh.ui.production.*`) — per-producer workspace layout, never server Settings. Stored ids are **resolved at read time, never rewritten**.
- **Staging:** `src/context/staging.js` `stageOrRun` gateway — with confirm-mode on, changes stage until F9/confirm.
- **Action bus:** `POST /api/v1/action` → `v1.action` SocketIO cue to all overlays. Ephemeral one-shot cues (never stored in State), e.g. `overlay.conceal` for the OBS hide/show stutter fix. PRSH owns action names; packages own animations.
- **OBS animation contract:** animated overlays get the browser-source `shutdown` property set by PRSH (fresh load on show); a per-source "Intro" toggle (`?intro=0`) makes a source resident/no-animation instead. **Don't regress this** — see `obs.jsx` comments.

---

## Layouts & Design Packages

Layouts are HTML files under `public/layout/`, enumerated by `server/api/v1/layouts.py` (type derivation from filename + group folder, `?size=`/`?team=`/`?dir=` variant expansion, `body { width/height }` size hint, `<meta name="overlay-settings">` style whitelist). Style settings are two-tier: `GLOBAL_DESIGN_KEYS` (`overlays.global.*`) and `LAYOUT_SETTINGS[layoutType]` (`overlays.{type}.{key}`), both in `src/routes/layouts/designConstants.js`.

- **Keep the `<meta>` whitelist and `LAYOUT_SETTINGS[type]` in sync.** The Production stage's Style section filters the registry down to what the whitelist names, so a key the mount honours but the whitelist omits is a setting nobody can reach. `src/routes/production/stage/eventheader.test.jsx` pins this.
- Wire every layout through **`OverlayBase.init()`** (`public/layout/lib/overlay-base.js`) — keep the HTML a thin shell over a `lib/*-mount.js`.
- **Every layout declares a sample bundle** (`init({ sample })`); `src/routes/layouts/overlay-sample.test.js` fails if one doesn't. The same bundles drive app-wide **demo mode** (`production.sample`) — see `src/routes/production/sample.jsx` for the rules that keep a fixture off a live broadcast.
- Element visuals are **re-themable SVGs** bound by `data-slot`/`data-tpl` hooks via `svg-theme-engine.js`, with package resolution falling back element-by-element to `default`.

> Deep dive: `.claude/skills/overlay-authoring/SKILL.md` (mount pattern, `OverlayBase` guarantees, theme contract, OBS reveal/conceal, add-a-Layout checklist) and `.claude/skills/design-package-authoring/SKILL.md` (package tiers, install rules, converting designer exports).

---

## Web Server (Port 5260)

### Networking

- Default bind: **`127.0.0.1` (loopback only).** Intentional: PRSH serves stateful APIs that mutate the live stream; binding wide by default would let anything on the LAN push fake state mid-broadcast.
- LAN access is opt-in via `server.allow_lan` (Settings). When true, binds `0.0.0.0`.
- `server/port_conflict.py` runs **synchronously before the async server** and reads `settings.json` directly. On conflict, a Tk modal offers auto-retry on the next free port, reveal-settings-folder, or quit (frozen builds).

### Static Mounts

`/assets/` (React build), `/game_assets/`, `/layout/`, `/design/`, `/branding/`. Read-only mounts are anchored to the repo root / bundle via `server/paths.py:app_root()` (CWD-independent); writable paths resolve through `user_data_dir()` (`PRSH_USER_DATA_DIR` override → frozen per-user root → `./user_data`).

API routes live in `server/api/v1/` — decorate with `@method` and register in `server/api/__init__.py`.

### SocketIO Events

- `v1.state.set` / `v1.state.set_batch` (+ `unset` variants) — state updates (server → clients). **Every consumer must handle both** — overlays get this for free via `OverlayBase.init`.
- `v1.settings.set` — settings updates (bidirectional).
- `v1.state.get` — client requests full state on connect.
- `v1.action` — ephemeral action cues (see action bus).

---

## Tournament Integration (start.gg)

Start.gg GraphQL via `StartGGProvider`, loaded by event URL/slug on the Competition tab. **Match-first:** a set loads into a `match.{M}` and the producer binds that match to a board. Both the API route and the bracket view's "Load to Match" go through `apply_startgg_set`. Unseeded phases produce string preview ids (`preview_…`) — set ids are `int | str`.

There is **no direct set→score path**. (Challonge was fully removed in July 2026; don't reintroduce provider branching.)

---

## Platform-Specific Behavior

- **macOS** — system-tray icon (`tray.py`, pystray) holds the process; no visible window.
- **Windows** — `win_window.py` opens a Tk taskbar window — the only clean way for end users to close the app on Windows.
- **Both frozen only** — `port_conflict.py` dialog if the configured port is taken. Source checkouts skip all of this and run headless.
- **Controller overlay (gc-overlay)** is **macOS only** (AF_UNIX MemoryWatcher sockets) and bundled via the `gc-overlay/` submodule. See `.claude/skills/controller-overlay/SKILL.md`.

### MSB Image Assets

PRSH does not ship MSB images (Nintendo IP). Users provide an asset pack under `user_data/game_assets/msb/{characterIcons,teamLogos,gameIcons}`. `server/api/v1/assets.py` validates against pyrio's canonical filename lists and surfaces missing files in Settings and the Welcome card. Custom location: `settings.assets.msb_path`.

### HUD File Default Paths

- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `%APPDATA%\Project Rio\HudFiles\decoded.hud.json`
- Override: Settings → Project Rio → HUD File Path

### Announcements & Logs

`server/announcements.py` merges a GitHub release check with `announcements.json` on the repo's `announcements` branch; per-user dismissals in `settings.announcements.dismissed_ids`. The in-app log viewer (`LogsViewer.jsx` + `server/api/v1/logs.py`) tails rotated logs by filename with path-traversal guards.

---

## Build Notes

`npm run dev` sets `TSH_DEV=1`, which enables CORS for the Vite origin. `scripts/freeze-version.py` bakes the version from the git tag during `prebuild`; `pyinstaller PRSH.spec` then produces `dist/PRSH.app` / `dist/PRSH/PRSH.exe`, and `installer/PRSH.iss` produces `PRSH-Setup.exe` on Windows.

## Testing

Both suites run in CI and **both must stay green**. Design doc: [TESTING.md](TESTING.md).

- `tests/conftest.py` autouse fixtures (`mock_socket`, `isolate_user_data`, `reset_singletons`) redirect State/Settings persistence to `tmp_path` and reset singletons — reuse them; **never let a test touch real `user_data/`**.
- Integration tests run in-process via `fastapi.testclient.TestClient` over `router_v1` (no uvicorn/socketio boot).
- When changing behavior a test encodes (e.g. the side cascade), update the test *in the same change* — code, tests, and this file must never disagree.
- Manual smoke (still worth doing for UI/overlay changes): `npm run dev`, check console, load a layout in OBS/browser and hard-refresh it.

> Deep dive: `.claude/skills/run-and-verify/SKILL.md` (fixture contract, per-area verification recipes, isolation caveats)

### Clearing Cached State

If the app fails to launch due to corrupt `user_data/state.json`: `echo '{}' > user_data/state.json`. In-app: Settings → Reset State (`POST /scoreboards/reset`).

---

## Key Files for Common Tasks

| Task | Files |
|------|-------|
| Change HUD game parsing | `server/rio/provider.py`, `server/rio/hud_watcher.py` |
| Side cascade / orientation | `server/rio/provider.py` (`_decide`, `_preserve_player_sides`) + `tests/unit/rio/test_side_preservation.py` |
| Binding model (pool/playback/transport) | `server/bindings.py`, `server/rio/rotation.py`, `server/api/v1/scoreboards.py` |
| Match lifecycle / series / start.gg sets | `server/match.py`, `server/api/v1/match.py`, `server/rio/game_end.py` |
| Add/modify state keys | `server/state.py`, `src/context/store.jsx` |
| Add API endpoints | `server/api/v1/` (decorate with `@method`), register in `server/api/__init__.py` |
| Settings schema | `server/settings.py` (defaults + migrations), `src/components/SettingsModal.jsx` |
| Add/modify a Layout or element overlay | `public/layout/<group>/` + `public/layout/lib/*-mount.js`, register in `src/routes/layouts/designConstants.js` (+ `src/routes/production/elements.js` if a Production element) |
| Sample data / demo mode | `public/layout/preview/*_sample.json`, `public/layout/lib/overlay-base.js` (`sample` option), `src/routes/production/sample.jsx` (switch + banner) |
| Theme/design packages | `public/design/`, `server/design_packages.py`, `public/layout/lib/svg-theme-engine.js` |
| Production console (rack/stage/rail) | `src/routes/production/{rack,rail}.jsx`, `stage/`, `desks/`, `kit/`, `elements.js`, `placements.js` (row identity), `addsource.jsx` (Add picker) |
| One board's console panel (mirrored game state, lineup readout, `side_reason`, corrections, rename) | `src/routes/production/desks/board.jsx` (`SidePanel`/`RosterGrid`/`useSideTeam`) + `boards.js` (`boardDeskId`, `useActiveBoards`), rows in `rack.jsx` (`useRigRows`, `RigSection`, `RowRemove` — add/remove a board), bodies in `production.jsx` (`deskBodiesFor`), face in `quickface.jsx` (`deskQuickFace`) |
| Shared containers (definitions, roster) | `src/routes/production/containers.js`, `stage/container.jsx`, `public/layout/shared/container.html`, `production.container_defs` in `server/settings.py`, `server/api/v1/layouts.py` |
| Container runtime (members, cross-fade, centering) | `public/layout/lib/fed-container.js` (the `MEMBERS` registry — add a member here, never control flow) + `lib/container-layers.js` (retained layers, cross-fade, `memberBox`, scope merge) |
| Container automations (rules, dwell, resting, reason) | `server/automations.py` (engine + `RESOLVERS`, registered on `State.hooks`), `server/state.py` (`_augment`), `src/routes/production/automations.js` (quick-add library), `stage/automation.jsx`, `tests/unit/test_automations.py` |
| Console with no OBS (catalog tier) | `src/routes/production/placements.js` (`catalogPlacements`, `useConsoleOffline`), `rack.jsx` (`CatalogSection`), `sourcestrip.jsx` (Copy URL), `addsource.jsx` (`open` vs `scene`) |
| Production OBS control / staging | `src/context/obs.jsx`, `src/context/staging.js` |
| Participant registry | `server/participants.py`, `src/routes/player_list/` |
| Post-game capture | `server/postgame.py` (+ StatFiles path gating) |
| Game Summary captain hero art (size/placement/mirror) | `public/layout/lib/captain-framing.js` (measured art + per-side frames) + `src/routes/layouts/captain-framing.test.js` (pins the no-clip / face-clear / one-size contract) |
| Tournament integration | `server/startgg/`, `server/api/v1/startgg.py` |
| Update character data | `user_data/games/msb/base_files/config.json` |
| Add team logo | drop `.png` into `user_data/game_assets/msb/teamLogos/` named after the MSB team |

---

## Performance Guidelines

This app runs alongside the game. **Performance is a hard requirement.**

### Backend

- **Always use `State.SetBatch()` for multi-key writes.** One HUD event touches 30-100+ keys; `Set()` per key emits 30-100+ SocketIO events. SetBatch collapses to one.

  ```python
  # WRONG — 30 SocketIO events
  for key, value in entries:
      await State.Set(key, value)

  # RIGHT — 1 SocketIO event
  await State.SetBatch(entries)
  await State.Save()
  ```

- **Never reintroduce DeepDiff, msgpack, or full-state cloning on the hot path.** Change detection uses the `changed_keys` list; `last_state` is updated selectively.
- **Cache frequently-read settings as class variables** — avoid `await Settings.Get()` in per-HUD-event callbacks.
- **Use indexed lookups** (e.g., `StatsTracker._api_index`) instead of O(n) DataFrame scans.
- **Concurrent awaits: `asyncio.gather()`, not `asyncio.wait()`** — the latter swallows exceptions.

### Frontend

- **Wrap data-connected components in `React.memo()`.**
- **One `useShallow` Zustand selector per component** — combine subscriptions.
- **`useMemo` for derived data passed as props.**

### SocketIO + Overlays

- **Handle both `v1.state.set` and `v1.state.set_batch`** in every consumer (overlays: use `OverlayBase.init`, which guarantees this).
- **`requestAnimationFrame` batching** — events within one frame flush as a single Zustand update.
- **Layouts: apply all batch items to local state first, render once.**

## Known Limitations

- Full state is sent on initial WebSocket connect (incremental after that).
- A second server instance shares `user_data/` and the port unless isolated via the `PRSH_USER_DATA_DIR`/`PRSH_PORT`/`PRSH_NO_BROWSER`/`PRSH_HUD_FILE` env overrides (`server/paths.py`; see the `run-and-verify` skill).
- `pandas` is ~50MB but required by pyrio.
