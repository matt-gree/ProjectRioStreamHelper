# CLAUDE.md — ProjectRioStreamHelper (PRSH)

## Project Overview

A web-based tournament stream overlay manager for **Mario Superstar Baseball (MSB)** via the Project Rio mod. Forked from TournamentStreamHelper (90+ fighting games, Qt/PySide6) and rebuilt as a single-game web app with a modern stack.

**Tech stack:** Python 3.12+, FastAPI + python-socketio, asyncio, orjson, watchfiles, pyrio (git dep), React 19 + Zustand + Mantine 7, Vite

**Server:** `server/` — FastAPI + SocketIO on configurable port (default 5260)
**Frontend:** `src/` — React SPA served by FastAPI in production, Vite dev server in development
**Builds:** PyInstaller (`PRSH.spec`) for standalone macOS `.app` and Windows `.exe`

---

## Architecture

### Core Data Flow

```
Project Rio Game → decoded.hud.json → HudWatcher (watchfiles OS events)
                                            ↓
Project Rio API ──────────────→ RioGameDataProvider ← StatsTracker
                                            ↓
                                    State.SetBatch()
                                      ↓         ↓
                          stream_labels/   SocketIO v1.state.set_batch
                          (off by default)       ↓
                                          React UI + OBS overlays
```

### Module Organization

```
server/
├── __init__.py              # FastAPI app + SocketIO setup
├── server.py                # Static mounts + route registration
├── state.py                 # Central state store (Set, SetBatch, Save, Export)
├── settings.py              # Settings + Config persistence
├── paths.py                 # Path helpers (user_data_dir)
├── tray.py                  # macOS/Windows system tray icon (pystray)
├── controller_overlay.py    # gc-overlay subprocess manager
├── api/v1/                  # REST + SocketIO endpoints
│   ├── rio.py               # HUD game state, swap, refresh
│   ├── state.py             # Get/set state keys
│   ├── settings.py          # Get/set settings
│   ├── scoreboards.py       # Score control (swap, up/down)
│   ├── game_pool.py         # Completed/ongoing games from API
│   ├── rotation.py          # Player rotation management
│   ├── stats.py             # Character stats
│   ├── layouts.py           # OBS layout metadata
│   ├── branding.py          # Tournament logos
│   ├── startgg.py           # Start.gg bracket integration
│   ├── challonge.py         # Challonge bracket integration
│   ├── controller.py        # gc-overlay control
│   └── update_team.py       # Team update endpoint
├── rio/
│   ├── provider.py          # RioGameDataProvider — HUD→State pipeline
│   ├── hud_watcher.py       # HudWatcher — OS-level file watching via watchfiles
│   ├── stats_tracker.py     # StatsTracker — merges API + HUD character stats
│   ├── stats_api.py         # Project Rio API client
│   ├── game_pool.py         # Ongoing/completed game pools
│   ├── rotation.py          # Player rotation logic
│   └── pyrio/               # Git submodule (matt-gree/pyrio)
├── startgg/                 # Start.gg GraphQL provider + queries
├── challonge/               # Challonge REST provider
└── utils/
    ├── deep_dict.py         # deep_get/deep_set/deep_unset
    ├── json.py              # orjson wrapper with async threshold
    ├── router.py            # API decorator
    └── keyring.py           # OAuth token storage

src/                         # React frontend (Vite + React 19 + Mantine 7)
├── main.jsx                 # Vite entry point
├── components/
│   ├── App.jsx              # Root with error boundary
│   ├── providers.jsx        # Provider wrappers (socket, theme)
│   ├── SettingsModal.jsx    # User preferences UI
│   ├── fields.jsx           # Common form fields
│   └── scoreboard/          # Scoreboard UI (PlayerSlot, TeamPanel, ScoreControls)
├── context/
│   ├── store.jsx            # Zustand stores (state, settings, config, bracket)
│   └── socket.jsx           # SocketIO provider with RAF batching
├── routes/
│   ├── root.jsx             # Main navigation shell
│   ├── scoreboard_manager/  # Scoreboard selection
│   ├── layouts/             # OBS layout preview & per-layout settings
│   ├── bracket/             # Start.gg bracket display
│   ├── tournament_info/     # Tournament metadata
│   ├── commentary/          # Commentary panel
│   ├── player_list/         # Roster browser
│   ├── ruleset/             # Stage strike (disconnected)
│   └── thumbnail_settings/  # Thumbnail gen (disconnected)
├── hooks/                   # Custom hooks (useStartGG, useTournament)
├── data/                    # Static data (msb.js — character/team info)
└── lang/                    # Localization strings

public/
├── layout/                  # OBS browser source HTML files
│   ├── scoreboard1/         # Scoreboard, team logos, rosters, stats overlays
│   ├── bracket/             # Tournament bracket overlay
│   └── lib/overlay-base.js  # Shared SocketIO client for all overlays
├── game_assets/             # Character icons (rio_characterIcons/), team logos (rio_teamLogos/)
└── favicon.png, logo*.png   # Branding assets

user_data/
├── settings.json            # User preferences (Settings class)
├── state.json               # Persisted application state
├── stream_labels/           # Exported state as text files (off by default)
├── branding/                # Tournament logos (served at /branding)
└── games/msb/base_files/    # MSB game config (config.json + character variants)
```

---

## Singleton Pattern

The server uses class-level singletons with `@classmethod` methods. State is shared via class variables:

| Class | Purpose |
|-------|---------|
| `State` | Central state store — in-memory dict + SocketIO broadcast + file export |
| `Settings` | User settings persistence (`user_data/settings.json`) |
| `Config` | Application config (server URL, version) |
| `RioGameDataProvider` | HUD watcher lifecycle + game data parsing + side preservation |
| `StatsTracker` | Per-character stats merging (API historical + HUD current game) |
| `HudWatcher` | File watcher instance (owned by RioGameDataProvider) |
| `OngoingGamePool` / `CompletedGamePool` | Game pools from Project Rio API |
| `RotationManager` | Player rotation logic |
| `StartGGProvider` | Start.gg bracket/tournament data |
| `ChallongeProvider` | Challonge bracket data |
| `ControllerOverlay` | gc-overlay subprocess manager |

---

## State — The Central Nervous System

Every change flows through `State.Set(key, value)` or `State.SetBatch(entries)`. This:
1. Updates the in-memory `state` dict
2. Tracks changed keys in `changed_keys` list
3. On `Save()`: compares only tracked keys against `last_state` snapshot
4. Exports changed keys as individual stream label files (if enabled)
5. Broadcasts to web clients via SocketIO (`v1.state.set` or `v1.state.set_batch`)

**Key patterns:**
- `State.Set("score.1.team.1.teamName", "Player1")` — single key, emits individual SocketIO event
- `State.SetBatch([(key1, val1), (key2, val2), ...])` — multiple keys, emits single `v1.state.set_batch` event
- `State.Save()` — computes diff from tracked keys only (no full-state diff library)
- `last_state` updated selectively via `copy.deepcopy` of changed paths only
- Text values → `./user_data/stream_labels/score/1/team/1/teamName.txt`
- File export is off by default (`general.disable_export: True`)

---

## Rio/MSB Integration

### Data Sources
1. **Local HUD file** (`decoded.hud.json`) — watched by `HudWatcher` using OS-level events via `watchfiles` (kqueue on macOS, inotify on Linux, ReadDirectoryChanges on Windows). Zero CPU between events.
2. **Project Rio API** (`https://api.projectrio.app/`) — polled on demand for stats, game history, ongoing games

### pyrio Library (git dependency: matt-gree/pyrio)
- `pyrio.stat_file_parser.HudObj` — parses HUD JSON
- `pyrio.lookup.Lookup` / `LookupDicts.CHAR_NAME` — character ID ↔ name mapping (cached singleton)
- `pyrio.team_name_algo.team_name(roster, captain)` — generates team name from roster composition

### MSB State Keys
```
score.{N}.inning, score.{N}.half_inning
score.{N}.outs, score.{N}.strikes, score.{N}.balls
score.{N}.batter, score.{N}.pitcher
score.{N}.cbRioRunnerOn1/2/3 (booleans)
score.{N}.team.{T}.player.{P}.rioName
score.{N}.team.{T}.player.{P}.rio_captainIndex
score.{N}.team.{T}.player.{P}.msb_team
score.{N}.team.{T}.player.{P}.character.{C} (roster of 9)
```

---

## Web Server (Port 5260)

FastAPI + python-socketio.

**Static Mounts:**
- `/assets/` — React build output
- `/game_assets/` — Character icons, team logos
- `/layout/` — OBS browser source HTML files
- `/branding/` — Tournament logos

**Key API Routes (`/api/v1/`):**

| Endpoint | Purpose |
|----------|---------|
| `GET /state` | Full state JSON |
| `GET/PUT /state/{key}` | Get/set individual state key |
| `GET/PUT /settings/{key}` | Get/set settings |
| `GET /rio/game` | Current HUD game state |
| `POST /rio/refresh` | Re-read HUD file |
| `POST /rio/swap` | Toggle team sides |
| `GET /scoreboards` | Active scoreboards |
| `GET /layouts` | Available OBS layouts |
| `POST /tournament/startgg` | Load Start.gg bracket by slug |
| `POST /tournament/challonge` | Load Challonge bracket |
| `GET/POST /controller` | gc-overlay status & control |

**SocketIO Events:**
- `v1.state.set` / `v1.state.set_batch` — state updates (server → clients)
- `v1.settings.set` — settings updates (bidirectional)
- `v1.state.get` — client requests full state on connect

---

## Player Side Preservation (HUD Games)

When streamers play back-to-back games, Project Rio can randomly assign them to away or home. The app preserves which side a player appears on via `RioGameDataProvider._preserve_player_sides()`.

### Three layers (in priority order):
1. **Pinned player setting** (Settings → Project Rio) — always places a specific player on a chosen side at the start of each new game
2. **Back-to-back detection** — detects when a returning player switched away/home between games and auto-swaps
3. **Manual swap buttons** — `toggle_sides_swapped()` persists across HUD events within a game

### Settings (in `user_data/settings.json`):
- `project_rio.pinned_player` — player name to pin
- `project_rio.pinned_side` — "Team 1" or "Team 2"
- `project_rio.pinned_hud_only` — only apply pin to HUD file games

---

## Controller Overlay (gc-overlay)

`ControllerOverlay` manages an optional gc-overlay subprocess that shows controller inputs in OBS.

- Auto-detects gc-overlay as a sibling directory (`../gc-overlay`) or in frozen build bundle
- Custom path configurable via Settings → Controller Overlay → Path
- Runs on its own port (default 8069), serves its own WebSocket + HTML overlay
- Settings: `controller_overlay.path`, `.port`, `.controller`, `.auto_start`

---

## Tournament Integration

### Start.gg
- GraphQL API via `StartGGProvider` (`server/startgg/`)
- Load bracket by tournament slug
- Displays bracket in React UI and OBS overlay

### Challonge
- REST API via `ChallongeProvider` (`server/challonge/`)
- Requires API key (configured in Settings)
- Load bracket by tournament URL

---

## Build & Run

### Development
```bash
# One-time setup
npm run setup          # macOS/Linux
npm run setup:win      # Windows

# Run (frontend + server concurrently)
npm run dev            # macOS/Linux
npm run dev:win        # Windows
```

Frontend: Vite on http://localhost:5173 (HMR)
Server: FastAPI on http://localhost:5260 (`TSH_DEV=1` enables CORS for Vite)

### Production
```bash
npm run build          # Build React SPA → dist/
python main.py         # Serve everything on :5260
```

### Frozen Builds (PyInstaller)
```bash
npm run build
pyinstaller PRSH.spec
```
- macOS: `dist/PRSH.app/`
- Windows: `dist/PRSH/PRSH.exe`

### Platform HUD File Paths
- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `~/AppData/Roaming/Project Rio/HudFiles/decoded.hud.json`
- Custom: Settings → Project Rio → HUD File Path

---

## Testing

No automated test suite. Manual testing:
1. Start dev server (`npm run dev`)
2. Verify React UI loads without console errors at http://localhost:5173
3. Check `localhost:5260/api/v1/state` returns valid JSON
4. Test HUD file watching by modifying `decoded.hud.json`
5. Test OBS overlays: add browser source at `localhost:5260/layout/scoreboard1/scoreboard.html`
6. Test tournament loading (Start.gg slug or Challonge URL + API key)

---

## Disconnected Features

Upstream TSH features preserved in code but disconnected from the running app:

- **Thumbnail System** — font loading + image compositing added startup overhead; not used for MSB
- **Stage Strike / Ruleset System** — MSB doesn't have start.gg rulesets; old code had network retry loops on startup

UI route stubs remain (`/ruleset`, `/thumbnail_settings`) but are non-functional.

---

## Key Files for Common Tasks

| Task | Files to Modify |
|------|----------------|
| Change game data parsing | `server/rio/provider.py`, `server/rio/hud_watcher.py` |
| Add/modify state keys | `server/state.py`, `src/context/store.jsx` |
| Add API endpoints | `server/api/v1/` |
| Modify settings schema | `server/settings.py` |
| Add frontend UI components | `src/components/`, `src/routes/` |
| Add/modify OBS overlays | `public/layout/` |
| Update character data | `user_data/games/msb/base_files/config.json` |
| Add/modify team logos | `public/game_assets/rio_teamLogos/` |
| Tournament integrations | `server/startgg/`, `server/challonge/` |
| Controller overlay | `server/controller_overlay.py`, `server/api/v1/controller.py` |

---

## Performance Guidelines

This application runs alongside games — **performance is a hard requirement, not a nice-to-have.** See `docs/performance/` for the full analysis.

### Backend: State Updates

**Always use `State.SetBatch()` when writing multiple keys.** A single HUD event touches 30-100+ state keys. Each `State.Set()` emits a separate SocketIO event. SetBatch collapses these into one `v1.state.set_batch` event.

```python
# WRONG — 30 SocketIO events
for key, value in entries:
    await State.Set(key, value)

# RIGHT — 1 SocketIO event
await State.SetBatch(entries)
await State.Save()
```

**Never add DeepDiff, msgpack, or full-state cloning back to the hot path.** State change detection uses the `changed_keys` list — keys are tracked at write time and compared directly in `_compute_changes()`. The `last_state` snapshot is updated selectively.

**Cache frequently-read settings as class variables.** Avoid `await Settings.Get()` in per-HUD-event callbacks. Read once in `Start()` and store as class variable.

**Use indexed lookups for repeated DataFrame/dict access.** `StatsTracker._api_index` provides O(1) lookups instead of O(n) DataFrame scans.

### Backend: Async Patterns

**Use `asyncio.gather()` for concurrent awaits, not `asyncio.wait()`.** `asyncio.wait` silently swallows exceptions.

### Frontend: React Components

**Wrap data-connected components in `React.memo()`.** Prevents subtree rebuilds when parent re-renders but props are unchanged.

**Use a single `useShallow` selector per component.** One shallow Zustand selector replaces N individual subscriptions.

```javascript
// RIGHT — 1 subscription, shallow equality on the player object
const player = useStateStore(useShallow(
    s => s?.score?.[sb]?.team?.[t]?.player?.[p]
));
```

**Use `useMemo` for derived data** passed as props to child components.

### Frontend: SocketIO Events

**Handle both `v1.state.set` and `v1.state.set_batch`** in all SocketIO consumers (React frontend and OBS overlay HTML files).

**Use `requestAnimationFrame` batching** — multiple events within one frame are flushed together in a single Zustand update.

### OBS Overlays

**Batch rendering** — on `v1.state.set_batch`, apply all items to local state first, then render once.

---

## Known Limitations

- Full state sent on initial WebSocket connect (incremental after that)
- pandas is a large dependency (~50MB) but required by pyrio
- No automated tests
- Disconnected feature UI stubs may confuse new users
