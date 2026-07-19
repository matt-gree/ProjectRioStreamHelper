# CLAUDE.md — ProjectRioStreamHelper (PRSH)

## Project Overview

A web-based tournament stream overlay manager for **Mario Superstar Baseball (MSB)** via the Project Rio mod. Forked from TournamentStreamHelper (originally Qt/PySide6) and rebuilt as a single-game web app.

**Tech stack:** Python 3.12+, FastAPI + python-socketio, asyncio, orjson, watchfiles, pyrio (git submodule), React 19 + Zustand + Vite.

**Server:** `server/` — FastAPI + SocketIO on configurable port (default 5260).
**Frontend:** `src/` — React SPA served by FastAPI in production, Vite dev server in development.
**Builds:** PyInstaller (`PRSH.spec`) for standalone macOS `.app` and Windows `.exe`; Inno Setup (`installer/PRSH.iss`) for the Windows installer.
**Submodules:** `server/rio/pyrio` (MSB data + stat parsing), `gc-overlay/` (controller overlay, macOS), `rio-visualizer/` (hit-trajectory simulation).

See [README.md](README.md) for end-user docs and [TESTING.md](TESTING.md) for the test-suite design.

## Agent Quickstart

```bash
./venv/bin/python -m pytest        # backend suite (~2s)
npm run test:run                   # frontend suite (vitest)
npm run build                      # frontend production build
npm run dev                        # Vite (5173) + FastAPI (5260) together
```

- `python main.py` from a source checkout runs the server **headless** (tray/Tk UI is gated on frozen builds, not dev mode). ⚠️ With no overrides it uses the real `./user_data/` — for verification, boot an **isolated instance** via `PRSH_USER_DATA_DIR` + `PRSH_PORT` + `PRSH_NO_BROWSER` + `PRSH_HUD_FILE`, and drive the HUD pipeline with `scripts/replay-hud.py` (see the `run-and-verify` skill).
- Layout HTML and `public/layout/lib/*.js` are static — no build step, but OBS/browser caches them: **hard refresh** (Cmd/Ctrl+Shift+R) after editing.
- CI (`.github/workflows/test.yml`) runs both suites on PRs and pushes to `main`/`2.0.0`.
- **Deep-dive skills** in `.claude/skills/` — this file is the map; the skills hold the depth. Load the matching one before working in its area: `state-keys-and-projectors` (State contract, namespaces, projector pattern), `match-binding-lifecycle` (fixtures, bindings, side cascade, game end, start.gg), `overlay-authoring` (layouts, mounts, themes, OBS behavior), `design-package-authoring` (theme SVG packages, converting designer exports), `run-and-verify` (tests, booting, smoke recipes).

---

## Glossary

These terms have specific meanings in this codebase. Use them precisely; correct an agent that drifts.

| Term | Meaning |
|------|---------|
| **Scoreboard / Board** | A tab in the UI; one entry under `score.{N}` in state. N ≥ 1; multiple may be active simultaneously. At least one always remains. |
| **Binding** | What fills a scoreboard: `scoreboards.binding.{N}` in **Settings** — a `pool` (membership) + `playback` (how the pool is shown) + `stats_tag`. Defined in `server/bindings.py`. There is **no "source" enum** — "manual" is just the empty binding (single playback, empty pool). |
| **Pool** | A binding's game membership: `filters` (search chips: tag/username/vs_username/limit), `scope` (`live \| completed \| both`), `pinned` (always in), `excluded` (never in), `refresh_interval` (0 = static). |
| **Playback** | How a board presents its pool: `mode: single \| rotate`, `gameId` (single: null = auto-follow), `interval` + `running` (rotate). |
| **Transport** | HUD file vs API — **derived, never user-picked**: board 1 carries the local HUD iff the global `project_rio.hud_enabled` toggle is on; every other board is API. `bindings.transport(sb)`. |
| **Side** | `1 = left`, `2 = right`. Used everywhere PRSH state references team position. Never use "away/home" in app vocabulary — Project Rio uses those internally but we translate. |
| **Team** | Synonymous with Side in state (`.player.{T}` where T∈{1,2}). |
| **Match** | The fixture object above scoreboards: `match.{M}` in state (participants per side, captain, format, series, stage `draft \| live \| post`). A board binds to it via `score.{N}.match = M` (int id, never a round-name string). |
| **Projector** | The resolve-by-copy pattern: a model (Match, Commentary, PlayerPlates, PostGame) resolves its records against the participant registry and copies the result into the state keys overlays read. Deterministic: writes the full key set (value or `""`) so unbinding blanks exactly what it set. |
| **Element** | A Production-page broadcast unit. **Direct** elements render from live state; **fed** elements are pushed content on the Callout Stage (stat callout, game summary, spotlight). Related: **shared source** / **dedicated source** / **target** / **feed** — see `src/routes/production/elements.js`. |
| **Layout** | An HTML file under `public/layout/`, served as an OBS Browser Source. Declares its style contract via `<meta name="overlay-settings">` and its native size via `body { width/height }`. |
| **Layout type** | Derived from filename + group folder (`server/api/v1/layouts.py`). Drives `?size=` / `?team=` variant expansion. |
| **Scene** | A full 1920×1080 Layout under `public/layout/scenes/` designed to drop into an OBS scene as the entire stream canvas. |
| **Overlay** | Generic OBS Browser Source terminology. Not PRSH-specific; do not use as a synonym for any of the terms above. |
| **Size variant** | `?size=s\|m\|l` query param, scoreboard layouts only (`xs`/`xl` retired with the SVG conversion; legacy URLs fall back to `l`). |
| **Team variant** | `?team=1\|2` query param. Applies to stats, roster, rosterstats, teamlogo, controller, playername. |
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

### Module Organization

```
server/
├── __init__.py              # FastAPI app + SocketIO setup
├── server.py                # Static mounts + route registration + provider lifecycle
├── state.py                 # Central state store (Set, SetBatch, Save, Export)
├── settings.py              # Settings + Config persistence (incl. scoreboards.binding migration)
├── bindings.py              # Pool + playback binding model — pure accessors, no cycles
├── match.py                 # Match fixture model + projector + series/decided logic
├── participants.py          # Participant registry (address book), REST-only singleton
├── commentary.py            # Commentary desk (max 4 slots) + projector
├── playerplates.py          # Player Plates element + projector
├── postgame.py              # Post-game capture (stat files) + postgame.{N}.* projection
├── matchup.py               # Matchup History band (singleton matchup.*)
├── schedule.py              # Schedule queue (match.scheduledAt surfaces)
├── design_packages.py       # Theme package enumeration/resolution
├── paths.py                 # Path helpers (per-user writable root in frozen builds)
├── port_conflict.py         # Pre-flight port check + Tk recovery dialog
├── tray.py / win_window.py  # macOS tray / Windows taskbar window (frozen builds only)
├── announcements.py         # GitHub-driven announcement fetcher + version check
├── controller_overlay.py    # gc-overlay subprocess manager (macOS only)
├── api/v1/
│   ├── action.py            # Universal action bus: POST /action → v1.action SocketIO cue
│   ├── rio.py               # HUD game state, swap, refresh
│   ├── state.py, settings.py, scoreboards.py, stats.py, logs.py, assets.py, branding.py
│   ├── game_pool.py         # Completed/ongoing pool endpoints
│   ├── rotation.py          # Rotate-playback control for a board's binding
│   ├── layouts.py           # Layout catalog: type derivation, size/team variants, supportedSettings
│   ├── match.py             # Match CRUD + bind + apply_startgg_set (the one set→match path)
│   ├── matchup.py, schedule.py, commentary.py, playerplates.py, postgame.py, participants.py
│   ├── startgg.py           # Start.gg bracket/sets/entrants endpoints
│   ├── design.py            # Design package endpoints
│   ├── visualizer.py        # Hit visualizer / spotlight endpoints
│   ├── controller.py        # gc-overlay control
│   └── announcements.py
├── rio/
│   ├── provider.py          # RioGameDataProvider — HUD→State + side cascade (~1050 lines)
│   ├── hud_watcher.py       # OS-level file watching via watchfiles
│   ├── stats_tracker.py     # Merges API historical + HUD current stats
│   ├── stats_api.py         # Project Rio API client
│   ├── game_pool.py         # OngoingGamePool / CompletedGamePool
│   ├── rotation.py          # PoolManager / PoolState — binding pool membership + rotate playback
│   ├── game_end.py          # GameEndWatcher — API-side game-end detection → Match.award_game
│   ├── resurface.py         # Address-book identity resurfacing onto boards
│   ├── hit_visualizer.py    # Hit viz data feed
│   └── pyrio/               # Git submodule (matt-gree/pyrio)
├── startgg/                 # Start.gg GraphQL provider + queries
└── utils/                   # deep_dict, orjson wrapper, @method router decorator, keyring

src/                         # React frontend
├── components/              # App, SettingsModal, WelcomeCard, LogsViewer, scoreboard/*
├── context/
│   ├── store.jsx            # Zustand stores (state, settings, config, bracket)
│   ├── socket.jsx           # SocketIO provider with RAF batching
│   ├── obs.jsx              # OBS WebSocket layer (browser→OBS, incl. shutdown-property reconciliation)
│   ├── staging.js           # Confirm-to-live staging gateway (stageOrRun, F9)
│   └── match.js, announcements.jsx
├── routes/
│   ├── production/          # Production console (default route): rack.jsx · stage/ · rail.jsx
│   │                        # + desks/ (match, capture, bracket), kit/ (row kit), elements.js registry
│   ├── scoreboard_manager/  # "Match" tab: per-board binding UI + MatchPanel
│   ├── competition/         # Merged tournament info + bracket (segmented)
│   ├── layouts/             # "Setup" tab: layout catalog + Design tab (layouts.jsx also holds the style-settings registries)
│   ├── commentary/, player_list/
└── lang/, data/, hooks/, lib/

public/
├── layout/                  # OBS browser source HTML (thin shells over lib/ mounts)
│   ├── lib/                 # overlay-base.js, *-mount.js per element, svg-theme-engine.js,
│   │                        # gsap-loader.js, reveal-gate.js, vendored three.js (~54k lines — ignore in LOC counts)
│   ├── scoreboard1/, scorecard/, bracket/, scenes/, rotator/, controller/,
│   ├── lowerthird/, commentary/, playerplates/, matchup/, schedule/,
│   ├── eventheader/, hitvisualizer/, shared/ (callout-stage, stats-feed, split-screen)
│   └── preview/             # Sample state JSON for in-app preview rendering
├── design/                  # Built-in theme packages (default/, classic/)
└── game_assets/             # (dev-mode only — frozen builds use user_data)

user_data/                   # settings.json, state.json, participants.json,
                             # stream_labels/, branding/, game_assets/msb/, design packages
```

In **frozen builds**, `user_data/` lives under the per-user writable root resolved by `server/paths.py` (e.g., `~/Library/Application Support/PRSH/user_data/` on macOS, `%LOCALAPPDATA%\PRSH\user_data\` on Windows). In **dev mode** it's `./user_data/` next to the repo.

---

## Singleton Pattern

The server uses class-level singletons with `@classmethod` methods. State is shared via class variables.

| Class | Purpose |
|-------|---------|
| `State` | Central state store — in-memory dict + SocketIO broadcast + file export |
| `Settings` / `Config` | User settings persistence / app config |
| `RioGameDataProvider` | HUD watcher lifecycle + game parsing + side cascade |
| `StatsTracker` | Per-character stats merging (API historical + HUD current game) |
| `HudWatcher` | File watcher (owned by RioGameDataProvider) |
| `OngoingGamePool` / `CompletedGamePool` | Game caches from the Project Rio API |
| `PoolManager` | Per-board binding pools: membership refresh + rotate playback (one `PoolState` per board) |
| `Match` | Fixture model + projector + series arithmetic |
| `Participants` | Participant registry (address book) |
| `Commentary` / `PlayerPlates` / `Matchup` / `Schedule` / `PostGame` | Element models + projectors |
| `GameEndWatcher` | API-board game-end detection → `Match.award_game` |
| `StartGGProvider` | Bracket/tournament data |
| `ControllerOverlay` | gc-overlay subprocess manager |
| `Announcements` | GitHub-driven release check + announcements feed |

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

### State namespaces (broadcast + persisted in state.json)

```
score.{N}.*                       — per-board live game + projected fixture data:
  inning, half_inning, outs/strikes/balls, batter, pitcher,
  cbRioRunnerOn1/2/3, star_chance, stadium, innings_selected, tag_set,
  away_linescore, home_linescore, phase, match (bound match id, int),
  match_conflict, side_reason,
  player.{T}.rioName, .rioName_override (producer pin, cleared on new HUD game),
  player.{T}.rio_captainIndex, .msb_team, .logo, .port, .team_stars,
  player.{T}.series_wins, .character.{C}.{name,position,is_starred,batting_hand,fielding_hand}

match.{M}.*                       — fixture: label, phase, stage (draft|live|post), scheduledAt,
                                    format.bestOf, series.{1,2}, decided, per-side participant/captain/port,
                                    provider.startgg.setId
commentary.*                      — desk slots (max 4), resolve-by-copy from registry
playerplates.*                    — plates band (modes: both|p1|p2 + location)
matchup.*                         — matchup-history band (singleton)
postgame.{N}.*                    — captured post-game: present, gameId, meta, player.{T}.totals
lowerthird.slots.{1..5}.*         — lower-third band slot contents
schedule.queue                    — upcoming-matches queue
scoreboards.rotation.{N}.*        — live rotation status MIRROR for overlays (read-only; config lives in Settings)
tournamentInfo.*, overlays.*      — tournament metadata; layout style settings
```

### Scoreboard config lives in Settings, not State

`scoreboards.active`, `scoreboards.aliases`, and `scoreboards.binding.{N}` (pool + playback + stats_tag) are **Settings** keys (`server/bindings.py` documents the schema). Legacy `scoreboards.sources` / flat `scoreboards.rotation` settings are read-only migration fallbacks — never write them.

> Deep dive: `.claude/skills/state-keys-and-projectors/SKILL.md`

---

## Scoreboards & Bindings

- Each board's binding is independent; boards can share pool contents.
- **Transport is derived**: board 1 carries the local HUD iff `project_rio.hud_enabled` (Settings toggle). There is no per-board source selector. Every other board is API-fed from its pool.
- `playback.mode: single` shows one game (`gameId: null` = auto-follow the pool); `rotate` cycles the pool at `interval` while `running`.
- `PoolManager` refreshes pool membership (`refresh_interval`; 0 = static/pinned-only), pre-fetches stats for rotations, and mirrors live rotation status into `scoreboards.rotation.{N}.*` state for overlays.
- **Resume-on-startup:** rotate boards that were `running` at shutdown restart in the background on next launch.
- A per-board game-mode `stats_tag` drives the stats fetch; on a new HUD game, `_apply_hud_game_mode()` auto-sets it from the HUD's `TagSetID` (overwriting a manual pick each game start).
- `POST /scoreboards/reset` is the escape hatch that clears stale board/binding state.
- Boards can be renamed (alias) and removed; at least one always remains. Layouts bind via `?scoreboard=N` — **a missing param defaults to board 1**, which is safe because board 1 always exists.

> Deep dive: `.claude/skills/match-binding-lifecycle/SKILL.md`

---

## Player-Side Cascade (who sits left/right)

Project Rio randomly assigns away/home each game. `_decide()` in `server/rio/provider.py` resolves each board's orientation with precedence:

**manual > match > pin > back_to_back > none**

- **Manual** — the swap button; sets `_user_overridden`, scope = current game only (a new game clears it). Swapping back to the pinned orientation releases the override early.
- **Match** — a bound match encodes *both* sides, so it strictly supersedes the pin on that board. `Match.orientation_for_sides` returns None for unbound boards or when live players don't match the fixture — then the pin governs.
- **Pin** — `project_rio.pinned_player` + `pinned_side` (+ `pinned_hud_only`). Global setting, applies to every board the cascade reaches.
- **Back-to-back** — previous game's player→side map; only consulted when nothing above matched.

The deciding layer is mirrored to `score.{N}.side_reason`. On a new game (inning reset) the manual flags clear and the manual base reseeds from the non-manual cascade.

---

## Match Model & Projectors

- A producer authors a `match.{M}` (or loads a start.gg set into one — `apply_startgg_set` in `server/api/v1/match.py` is the **only** set→match path). Binding a board (`score.{N}.match = M`) projects fixture fields into the `score.{N}.player.{T}.*` keys overlays already read.
- **The match owns the series** (games won within the Bo format); boards own only their live game. Post-game capture and `GameEndWatcher` credit wins via `Match.award_game`; `decided` is set when a side reaches ceil(bestOf/2). The projector mirrors `series_wins` onto bound boards.
- **Game-end detection:** HUD board → post-game stat-file capture (`server/postgame.py`, gated on GameID + Loaded-from-HUD==0). API boards → `GameEndWatcher` (ongoing-pool drop-out, matched by username+start_time, retries 12×10s).
- **Identity gate:** if live players don't match the bound fixture, `score.{N}.match_conflict` raises the app-wide banner; a decided-mismatch auto-retires the binding.
- Match 1 is the **primary match**: setting its players auto-preps the Matchup band and Player Plates (both re-pointable).
- **Projector rules** (Match, Commentary, PlayerPlates, PostGame all follow this shape — reuse it, don't invent a new one): resolve records against the Participants registry, write the *full* owned key set via `SetBatch` (value or `""`), wrap `project_all()` startup hooks in try/except so a bad record never blocks boot. A captain-less match projection must never blank a live HUD captain.

> Deep dive: `.claude/skills/match-binding-lifecycle/SKILL.md` (fixtures, bindings, side cascade, game end) and `.claude/skills/state-keys-and-projectors/SKILL.md` (the projector pattern + add-an-element checklist)

---

## Production Tab & Elements

The Production tab is a **console with three surfaces** — rack (monitor + select), stage (work on the one selected thing), quick rail (producer-pinned cards). Every element declares the same contract (registration · quick face · stage body) and all three surfaces compose from the shared row kit. **Read `.claude/skills/production-console-contract/SKILL.md` before touching `src/routes/production/`.**

- `src/routes/production/` — the default route: OBS scene/source control (via **browser-side** OBS WebSocket, `src/context/obs.jsx`, localhost:4455 — reaches the producer's OBS even in dual-machine setups). `production.jsx` is a thin shell (top bar + 3-column grid + PendingBar); `rack.jsx`, `stage/`, `rail.jsx`, `desks/`, `kit/` hold the surfaces.
- **Selection, rail pins and phase are browser-local** (`usePersistentState`, `prsh.ui.production.*`) — per-producer workspace layout, never server Settings.
- **Staging:** `src/context/staging.js` `stageOrRun` gateway — with confirm-mode on, changes stage until F9/confirm. Overlay style settings a producer flips live (Scorecard bands, Event Header rows) route through `stageSettingsSet` and appear on the stage, not only in Setup.
- **Desks** are the non-element tier (Match · Capture · Bracket): rows in `DESKS` (`rack.jsx`), bodies in `DESK_BODIES` (`production.jsx`), faces in `DESK_QUICK_FACES` (`quickface.jsx`) — add all three.
- **Action bus:** `POST /api/v1/action` → `v1.action` SocketIO cue to all overlays. Ephemeral one-shot cues (never stored in State), e.g. `overlay.conceal` for the OBS hide/show stutter fix. PRSH owns action names; packages own animations.
- **OBS animation contract:** animated overlays get the browser-source `shutdown` property set by PRSH (fresh load on show); a per-source "Intro" toggle (`?intro=0`) makes a source resident/no-animation instead. Don't regress this — see `obs.jsx` comments.
- **Fed elements** (stat callout, game summary/PvP, character spotlight, stats feed) render on the 1920×1080 **Callout Stage** (`public/layout/shared/callout-stage.html`) and are pushed from Production. The spotlight/hit-viz use vendored three.js and pyrio's `simulate_contacts` via the rio-visualizer submodule.

## Design Packages (Themes)

- Element visuals are **re-themable SVGs**: a theme file declares `data-slot`/`data-tpl` hooks; `public/layout/lib/svg-theme-engine.js` injects and binds them; mounts auto-fit text.
- Packages live in `public/design/{default,classic}/` (built-in) + user packages in `user_data/design_packages/`; served via `GET /design/{package}/{file}` with resolution falling back element-by-element to `default`. Server side: `server/design_packages.py`, `server/api/v1/design.py`. Selected in Setup → Design.
- Theme contract details (e.g. `--side1/--side2/--well` vars, mount-point conventions) live in the theme SVGs and mount scripts — read an existing pair (e.g. `lowerthird`) before authoring. Per-element slot contracts: `public/design/README.md`.

> Deep dive: `.claude/skills/design-package-authoring/SKILL.md` (package tiers, install rules, converting designer exports, verification)

---

## Layouts — Type System and Style Contract

Each Layout (HTML file under `public/layout/`) is enumerated by `server/api/v1/layouts.py`, which:

1. **Derives a layout type** from the filename stem and group folder. `scenes/*` → `scene`; `bracket/*` → `bracket`; otherwise strips trailing digits from the stem.
2. **Expands variants** if applicable: size (`?size=s|m|l`, scoreboard only), team (`?team=1|2` — stats, roster, rosterstats, teamlogo, controller, playername), direction (`?dir=`, fourcam).
3. **Parses `body { width/height }`** for the OBS browser-source size hint.
4. **Parses `<meta name="overlay-settings">`** — the layout's whitelist of style knobs it respects.

### Style settings: two-tier system

Defined in `src/routes/layouts/layouts.jsx` (+ `designConstants.js`):

- **`GLOBAL_DESIGN_KEYS`** + **`GLOBAL_DESIGN_DEFAULTS`** — globally-themed knobs (accentColor, cardBg, textColor, borderRadius, fonts, shadows, showCaptains, …). Live at `overlays.global.*`, apply to every layout that opts in via its `<meta>` whitelist.
- **`LAYOUT_SETTINGS[layoutType]`** — per-layout-type element settings. Live at `overlays.{type}.{key}` (scorecard is per-board: `overlays.scorecard.{N}.*`).
- **`OVERRIDABLE_GLOBAL_KEYS`** — globals a layout type can pin an override for.

The `<meta name="overlay-settings">` whitelist is the source of truth for what the Setup tab exposes per file.

### Adding a new Layout — checklist

1. Drop the HTML file in the appropriate `public/layout/<group>/` folder.
2. Set `body { width: _px; height: _px }` to the native size.
3. Declare every style knob it respects in `<meta name="overlay-settings" content="...">`.
4. Register new element-only settings in `LAYOUT_SETTINGS[layoutType]`; new global knobs in `GLOBAL_DESIGN_KEYS`/defaults/overridables.
5. Wire through **`OverlayBase.init()`** (`public/layout/lib/overlay-base.js`) — it centrally handles the SocketIO connect, initial fetch, `v1.state.set`/`set_batch`/`unset` dispatch, and `v1.action` cues. Write a `*-mount.js` in `lib/` and keep the HTML a thin shell (copy an existing pair, e.g. `playerplates`).
6. Batch rendering: apply all changed keys to local state first, render once.
7. Use `?scoreboard=N` to bind board data (default `1`); `?size=`/`?team=` if the file is a variant template.
8. If it's a Production element, register it in `src/routes/production/elements.js` too.
9. **Keep the `<meta>` whitelist and `LAYOUT_SETTINGS[type]` in sync.** Setup filters the registry down to what the whitelist names, so a key the mount honours but the whitelist omits is a setting nobody can reach. `src/routes/production/stage/eventheader.test.jsx` pins this for the layouts whose settings the console drives.

> Deep dive: `.claude/skills/overlay-authoring/SKILL.md` (mount pattern, theme contract, OBS reveal/conceal behavior)

---

## Web Server (Port 5260)

### Networking

- Default bind: **`127.0.0.1` (loopback only).** Intentional: PRSH serves stateful APIs that mutate the live stream; binding wide by default would let anything on the LAN push fake state mid-broadcast.
- LAN access is opt-in via `server.allow_lan` (Settings). When true, binds `0.0.0.0`.
- `server/port_conflict.py` runs **synchronously before the async server** and reads `settings.json` directly. On conflict, a Tk modal offers auto-retry on the next free port, reveal-settings-folder, or quit (frozen builds).

### Static Mounts

`/assets/` (React build), `/game_assets/`, `/layout/`, `/design/`, `/branding/`. Read-only mounts are anchored to the repo root / bundle via `server/paths.py:app_root()` (CWD-independent); writable paths resolve through `user_data_dir()` (`PRSH_USER_DATA_DIR` override → frozen per-user root → `./user_data`).

### Key API Routes (`/api/v1/`)

| Endpoint | Purpose |
|----------|---------|
| `GET /state`, `GET/PUT /state/{key}` | Full state / individual key |
| `GET/PUT /settings` | Settings (SECRET_KEYS values are redacted) |
| `POST /action` | Broadcast a one-shot `v1.action` cue to overlays |
| `GET /rio/game`, `POST /rio/refresh`, `POST /rio/swap` | HUD game / re-read / manual side swap |
| `GET /scoreboards`, `POST /scoreboards/reset` | Boards; reset stale board/binding state |
| `PUT /scoreboards/{sb}/player/{t}/name-override` | Producer name pin for a slot |
| `GET /layouts` | Layout catalog (type/variants/supportedSettings/dims) |
| `GET /games`, `GET /games/ongoing` | Game pool endpoints |
| `POST /rotation/...` | Rotate-playback control for a board |
| `/match/*` (+ `/match/{m}/startgg-set`) | Match CRUD, bind, set loading |
| `/participants/*` (+ `/participants/import/startgg`) | Address book CRUD + entrant import |
| `/commentary/*`, `/playerplates/*`, `/matchup/*`, `/schedule/*`, `/postgame/*` | Element models |
| `/startgg/*` | Tournament load, phases, sets, entrants, bracket-data |
| `/design/*`, `/visualizer/*`, `/controller`, `/announcements`, `/logs`, `/assets/msb/validate` | Themes, hit viz, gc-overlay, announcements, logs, asset validation |

### SocketIO Events

- `v1.state.set` / `v1.state.set_batch` (+ `unset` variants) — state updates (server → clients). **Every consumer must handle both** — overlays get this for free via `OverlayBase.init`.
- `v1.settings.set` — settings updates (bidirectional).
- `v1.state.get` — client requests full state on connect.
- `v1.action` — ephemeral action cues (see action bus).

---

## Tournament Integration (start.gg)

Start.gg GraphQL via `StartGGProvider`, loaded by event URL/slug on the Competition tab. **Match-first:** a set loads into a `match.{M}` (participant-registry upsert, round name → label, phase name → `match.phase`, `totalGames` → `format.bestOf`, reported score → `series` seed, setId → `provider.startgg.setId`) and the producer binds that match to a board. Both the API route and the bracket view's "Load to Match" go through `apply_startgg_set`. Unseeded phases produce string preview ids (`preview_…`) — set ids are `int | str`.

There is **no direct set→score path**. (Challonge was fully removed in July 2026; don't reintroduce provider branching.)

---

## Announcements

`server/announcements.py` pulls two sources from GitHub and merges them into a unified feed:

1. **Release check** — `GET /repos/{repo}/releases/latest`; a newer tag synthesizes an "Update available" entry.
2. **`announcements.json`** — raw file on the repo's `announcements` branch (id/title/body/severity/min-max_version/expires_at/link). Maintainer publishes via the `Announce - *` GitHub workflows.

Per-user dismissals in `settings.announcements.dismissed_ids`.

## Logs

In-app log viewer (`LogsViewer.jsx` + `server/api/v1/logs.py`): lists rotated log files in the per-user logs dir, tails by filename with path-traversal guards.

---

## Controller Overlay (gc-overlay)

`ControllerOverlay` manages an optional subprocess that draws controller inputs as a separate OBS browser source.

- **macOS only** (AF_UNIX MemoryWatcher sockets): gated by `controller_overlay.PLATFORM_SUPPORTED`, the `Config.controller_overlay_supported` flag (hides UI), `layouts.py` (omits `controller/` from the catalog), and `PRSH.spec` (bundles gc-overlay on Darwin only).
- **Bundled via the `gc-overlay/` git submodule.** Detection order: frozen nested binary → in-repo submodule → sibling `../gc-overlay/`; custom override in Settings. Frozen builds run the standalone binary (re-`chmod +x`'d); source checkouts run `python main.py` in gc-overlay's own venv.
- **Build:** `scripts/build-gc-overlay.py` (invoked from `PRSH.spec`; `SKIP_GC_OVERLAY_BUILD=1` to skip). gc-overlay owns its version; update via `git submodule update --remote gc-overlay`.
- Runs on its own port (default 8069). Settings: `controller_overlay.{path,port,controller,auto_start}`.
- **Per-side follow:** the HUD reports each player's controller port → `score.{N}.player.{T}.port`; `public/layout/controller/controller.html` (`?team=1|2`) iframes gc-overlay at that port, so a left/right browser source follows whoever is on that side.

---

## Platform-Specific Startup

- **macOS** — system-tray icon (`tray.py`, pystray) holds the process; no visible window.
- **Windows** — `win_window.py` opens a Tk taskbar window (app name, version, server URL, exit button) — the only clean way for end users to close the app on Windows.
- **Both frozen only** — `port_conflict.py` dialog if the configured port is taken. Source checkouts skip all of this and run headless.

---

## MSB Image Assets

PRSH does not ship MSB images (Nintendo IP). Users provide an asset pack under `user_data/game_assets/msb/{characterIcons,teamLogos,gameIcons}`. `server/api/v1/assets.py` validates against pyrio's canonical filename lists and surfaces missing files in Settings and the Welcome card. Custom location: `settings.assets.msb_path`.

---

## Build & Run

### Development

```bash
npm run setup          # macOS/Linux — npm install + venv + poetry install + build
npm run setup:win      # Windows

npm run dev            # macOS/Linux — Vite + FastAPI concurrently
npm run dev:win        # Windows
```

- Vite: http://localhost:5173 (HMR); FastAPI: http://localhost:5260 (`TSH_DEV=1` enables CORS for Vite).

### Production / Frozen

```bash
npm run build && python main.py            # serve everything on :5260
npm run build && pyinstaller PRSH.spec     # dist/PRSH.app (macOS) / dist/PRSH/PRSH.exe (Windows)
```

`scripts/freeze-version.py` bakes the version from the git tag in `prebuild`; then `installer/PRSH.iss` → `PRSH-Setup.exe` on Windows.

### HUD File Default Paths

- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `%APPDATA%\Project Rio\HudFiles\decoded.hud.json`
- Override: Settings → Project Rio → HUD File Path

---

## Testing

Two suites; both run in CI (`.github/workflows/test.yml`) and both must stay green:

```bash
./venv/bin/python -m pytest        # backend: tests/unit + tests/integration (~2s)
npm run test:run                   # frontend: vitest
```

- Design doc: [TESTING.md](TESTING.md) — philosophy (protect silently-regressing logic; test at the seam; pin overlay/OBS contracts), tiers, and per-module coverage tables.
- `tests/conftest.py` autouse fixtures (`mock_socket`, `isolate_user_data`, `reset_singletons`) redirect State/Settings persistence to `tmp_path` and reset singletons — reuse them; never let a test touch real `user_data/`.
- Integration tests run in-process via `fastapi.testclient.TestClient` over `router_v1` (no uvicorn/socketio boot).
- When changing behavior a test encodes (e.g. the side cascade), update the test *in the same change* — code, tests, and this file must never disagree.

Manual smoke (still worth doing for UI/overlay changes): `npm run dev`, check console, load a layout in OBS/browser and hard-refresh it.

> Deep dive: `.claude/skills/run-and-verify/SKILL.md` (fixture contract, per-area verification recipes, isolation caveats)

### Clearing Cached State

If the app fails to launch due to corrupt `user_data/state.json`: `echo '{}' > user_data/state.json`. In-app: Settings → Reset State (`POST /scoreboards/reset`) clears stale board/binding state.

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
| Add/modify a Layout or element overlay | `public/layout/<group>/` + `public/layout/lib/*-mount.js`, register in `src/routes/layouts/layouts.jsx` (+ `src/routes/production/elements.js` if a Production element) |
| Theme/design packages | `public/design/`, `server/design_packages.py`, `public/layout/lib/svg-theme-engine.js` |
| Production console (rack/stage/rail) | `src/routes/production/{rack,rail}.jsx`, `stage/`, `desks/`, `kit/`, `elements.js` |
| Production OBS control / staging | `src/context/obs.jsx`, `src/context/staging.js` |
| Participant registry | `server/participants.py`, `src/routes/player_list/` |
| Post-game capture | `server/postgame.py` (+ StatFiles path gating) |
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
- `layouts.jsx` (~2200 lines) is a known monolith pending a split.
