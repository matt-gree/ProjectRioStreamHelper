# CLAUDE.md — TournamentStreamHelper (MSB Fork)

## Project Overview

This is a web-based rewrite of TournamentStreamHelper (TSH), adapted for **Mario Superstar Baseball (MSB)** via the Project Rio mod. It manages tournament stream overlays for OBS via browser sources. The upstream TSH supports 90+ fighting games with Qt/PySide6; this fork strips that to focus on a single game with a modern web stack.

**Tech stack:** Python 3.12+, FastAPI + python-socketio, asyncio, orjson, watchfiles, pyrio (git submodule), React 19 + Zustand + Mantine 7

**Server entry point:** `server/` package — FastAPI + SocketIO on configurable port (default 5260)

**Frontend:** `src/` — React SPA served by the FastAPI server

---

## Architecture

### Core Data Flow

```
Project Rio Game → decoded.hud.json → HudWatcher (watchfiles)
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
├── state.py                 # Central state store (Set, SetBatch, Save, Export)
├── settings.py              # Settings + Config persistence
├── routes/                  # FastAPI route handlers
├── rio/
│   ├── provider.py          # RioGameDataProvider — HUD→State pipeline
│   ├── hud_watcher.py       # HudWatcher — OS-level file watching via watchfiles
│   ├── stats_tracker.py     # StatsTracker — merges API + HUD character stats
│   ├── stats_api.py         # Project Rio API client
│   └── pyrio/               # Git submodule (matt-gree/pyrio)
└── utils/
    ├── deep_dict.py         # deep_get/deep_set/deep_unset
    └── json.py              # orjson wrapper with thread threshold

src/                         # React frontend (Vite + React 19 + Mantine 7)
├── components/
│   └── scoreboard/          # Scoreboard UI components (PlayerSlot, ScoreControls, etc.)
├── context/
│   ├── store.jsx            # Zustand stores (state, settings, config)
│   └── socket.jsx           # SocketIO provider with RAF batching
└── data/                    # Static data (MSB characters, teams)

public/
├── overlays/                # OBS browser source HTML files
└── game_assets/             # Character icons, team logos, etc.
```

### Data Files

```
user_data/
├── settings.json           # User preferences (loaded by Settings class)
├── state.json              # Persisted application state
├── stream_labels/          # Exported state as text files (disabled by default)
└── games/msb/base_files/   # MSB game config (config.json + character variants)
```

---

## Singleton Pattern

The server uses class-level singletons with `@classmethod` methods. State is shared via class variables:

| Class | Purpose |
|-------|---------|
| `State` | Central state store — in-memory dict + SocketIO broadcast + file export |
| `Settings` | User settings persistence (`user_data/settings.json`) |
| `RioGameDataProvider` | HUD watcher lifecycle + game data parsing + side preservation |
| `StatsTracker` | Per-character stats merging (API historical + HUD current game) |
| `HudWatcher` | File watcher instance (owned by RioGameDataProvider) |

---

## State — The Central Nervous System

Every change flows through `State.Set(key, value)` or `State.SetBatch(entries)`. This:
1. Updates the in-memory `state` dict
2. Tracks changed keys in `changed_keys` list
3. On `Save()`: compares only tracked keys against `last_state` snapshot
4. Exports changed keys as individual stream label files
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
1. **Local HUD file** (`decoded.hud.json`) — watched by `HudWatcher` using OS-level events via `watchfiles` (kqueue on macOS, inotify on Linux, ReadDirectoryChanges on Windows). Zero CPU usage between events.
2. **Server API** (`https://api.projectrio.app/populate_db/ongoing_game/`) — polled on demand with 5s timeout

### pyrio Library (git submodule: matt-gree/pyrio)
- `pyrio.stat_file_parser.HudObj` — parses HUD JSON
- `pyrio.lookup.Lookup` / `LookupDicts.CHAR_NAME` — character ID ↔ name mapping (cached singleton)
- `pyrio.team_name_algo.team_name(roster, captain)` — generates team name from roster composition

### MSB State Keys
```
score.{N}.inning, score.{N}.half_inning
score.{N}.outs, score.{N}.strikes, score.{N}.balls
score.{N}.batter, score.{N}.pitcher
score.{N}.runnerOn1/2/3 (booleans)
score.{N}.team.{T}.player.{P}.rioName
score.{N}.team.{T}.player.{P}.rio_captainIndex
score.{N}.team.{T}.player.{P}.msb_team
score.{N}.team.{T}.player.{P}.character.{C} (roster of 9)
```

---

## Web Server (Port 5260)

FastAPI + python-socketio. Key endpoints:
- `GET /program-state` — full state JSON
- `GET /ruleset` — current match ruleset
- Score control: `/scoreboard1-team1-scoreup`, `-scoredown`, `-swap-teams`
- Set management: `/get-sets`, `/load-set?set=<id>`
- Stage strike: `/scoreboard1-stage-<action>`
- Commentary: `/update-commentary-<N>`, `/get-comms`
- Bracket: `/update-bracket`

All mutations are handled via SocketIO events or REST endpoints.

---

## Known Limitations & Technical Debt

### Performance (Optimized)
- **State.SetBatch()** — bulk state updates emit a single `v1.state.set_batch` SocketIO event instead of 100+ individual ones
- **Changed-key tracking** — `State.Save()` diffs only tracked keys via direct comparison, no DeepDiff library
- **Selective snapshots** — `last_state` updated via `copy.deepcopy` of changed paths only, no full-state clone
- **Event-based HUD watching** — `watchfiles` library uses OS kernel events (kqueue/inotify), zero polling
- **Indexed DataFrame lookups** — `StatsTracker._api_index` dict for O(1) character stat access
- **Cached hot-path settings** — `_hud_target` cached as class variable, avoids async reads per HUD event
- **File export off by default** — `general.disable_export: True` skips stream label file I/O
- **Frontend RAF batching** — SocketIO events batched via `requestAnimationFrame` before React state update
- **React.memo + useShallow** — `PlayerSlot` wrapped in `memo()`, single shallow Zustand selector replaces 20+ individual ones

### Remaining Concerns
- WebServer broadcasts **entire state** on initial connect (incremental updates via batch after that)
- pandas is a large dependency (~50MB) but required by pyrio

---

## Build & Run

```bash
# Install dependencies
pip install -r dependencies/requirements.txt

# Run the application
python main.py
```

**Dependencies:** fastapi, uvicorn, python-socketio, httpx, orjson, watchfiles, loguru, Pillow, pandas, pyrio (git submodule)

**Platform paths for HUD file:**
- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `~/AppData/Roaming/Project Rio/HudFiles/decoded.hud.json`
- Or set custom path in Settings → Project Rio → HUD File Path

---

## Testing

No automated test suite exists. Manual testing:
1. Start the dev server (`npm run dev` for frontend, `python -m server` or equivalent for backend)
2. Verify the React UI loads without errors
3. Check `localhost:5260/api/v1/state` returns valid JSON
4. Test HUD file watching by modifying `decoded.hud.json`
5. Test OBS overlays by adding browser sources pointed at `localhost:5260/overlays/`

---

## Disconnected Features

The following upstream TSH features have been **disconnected from the app** to reduce startup overhead and simplify the UI. The underlying code is preserved in the repo and can be reconnected if needed.

### Thumbnail System (disconnected)
- **Files preserved:** `TSHThumbnailSettingsWidget.py`, `thumbnail/main_generate_thumbnail.py`, `thumbnail/` module
- **What was removed:** Import and widget creation in `TournamentStreamHelper.py`, "Generate Thumbnail" button and `GenerateThumbnail()` method in `TSHScoreboardWidget.py`, `/scoreboard<N>-get-thumbnail-<fmt>` web route, `get_thumbnail()` in `TSHWebServerActions.py`
- **Why:** Thumbnail generation ran at startup (font loading, image compositing, 219ms font alias penalty) and is not currently used for MSB

### Stage Strike / Ruleset System (disconnected)
- **Files preserved:** `TSHScoreboardStageWidget.py` (with improved cache-based ruleset loading), `TSHStageStrikeLogic.py`, `stage_strike_app/` frontend
- **What was removed:** Stage tab in main window, all stage strike web routes and SocketIO events (10 HTTP + 8 WS), `ruleset()` and stage strike methods in `TSHWebServerActions.py`, `stageWidget` parameter from `WebServer`/`WebServerActions`
- **Why:** MSB doesn't have start.gg rulesets; the old code also downloaded rulesets from start.gg on every launch and had an infinite retry loop on failure
- **Note:** `TSHScoreboardStageWidget.py` was improved before disconnection — it now loads from a cached `assets/rulesets.json` on init (instead of hitting the network) and has a "Refresh start.gg Rulesets" button for on-demand downloading

---

## Player Side Preservation (HUD Games)

When streamers play back-to-back games, Project Rio can randomly assign them to away or home. The app now preserves which side a player appears on across games via `RioGameDataProvider._preserve_player_sides()`.

### Three layers (in priority order):
1. **Pinned player setting** (Settings → Project Rio) — always places a specific player on a chosen side at the start of each new game. Manual swap buttons override the pin for the rest of the current game; swapping back clears the override.
2. **Back-to-back detection** — if no pin is configured, detects when a returning player switched away/home between games and auto-swaps to keep them in place.
3. **Manual swap buttons** — `SwapTeams` and `OnSwapRioDataClicked` call `toggle_sides_swapped()` which persists across HUD events within a game.

### Key state flags in `RioGameDataProvider`:
- `_sides_swapped` — persisted swap decision, applied on every HUD event
- `_user_overridden` — set by manual swap buttons, cleared on new game or when user swaps back to pinned position
- `_prev_player_sides` / `_prev_inning` — tracking for back-to-back and new-game detection

### Settings (persisted in `user_data/settings.json`):
- `project_rio.pinned_player` — player name to pin
- `project_rio.pinned_side` — "Team 1" or "Team 2"
- `project_rio.pinned_hud_only` — only apply pin to HUD file games

---

## Key Files for Common Tasks

| Task | Files to Modify |
|------|----------------|
| Change game data parsing | `server/rio/provider.py`, `server/rio/hud_watcher.py` |
| Add/modify state keys | `server/state.py` |
| Add API endpoints | `server/routes/` |
| Modify settings schema | `server/settings.py` |
| Add frontend UI components | `src/components/` |
| Add/modify OBS overlays | `public/overlays/` |
| Update character data | `user_data/games/msb/base_files/config.json` |
| Add/modify team logos | `public/game_assets/rio_teamLogos/` |

---

## Performance Guidelines

This application runs alongside games — **performance is a hard requirement, not a nice-to-have.** The patterns below were established to eliminate game stuttering caused by the HUD update hot path. All new code must follow them.

See `docs/performance/` for the full analysis that motivated these patterns.

### Backend: State Updates

**Always use `State.SetBatch()` when writing multiple keys.** A single HUD event touches 30-100+ state keys. Each `State.Set()` emits a separate SocketIO event. Using SetBatch collapses these into one `v1.state.set_batch` event.

```python
# WRONG — 30 SocketIO events, 30 React re-render triggers
for key, value in entries:
    await State.Set(key, value)

# RIGHT — 1 SocketIO event, 1 React re-render trigger
await State.SetBatch(entries)
await State.Save()
```

**Never add DeepDiff, msgpack, or full-state cloning back to the hot path.** State change detection uses the `changed_keys` list — keys are tracked at write time and compared directly in `_compute_changes()`. The `last_state` snapshot is updated selectively with `copy.deepcopy` of only changed values.

**Cache frequently-read settings as class variables.** Avoid `await Settings.Get()` in callbacks that fire on every HUD event. Instead, read the setting once in `Start()` or a reset method and store it as a class variable. Example: `RioGameDataProvider._hud_target`.

**Use indexed lookups for repeated DataFrame/dict access.** `StatsTracker._api_index` is a `{(username, char_name): row}` dict built once after API fetch, providing O(1) lookups instead of O(n) DataFrame boolean masks on every HUD event.

### Backend: File Watching

**Use OS-level file events, not polling.** `HudWatcher` uses the `watchfiles` library which wraps kqueue (macOS), inotify (Linux), and ReadDirectoryChanges (Windows). This means zero CPU between events. Never replace this with `asyncio.sleep()` polling loops.

### Backend: Async Patterns

**Use `asyncio.gather()` for concurrent awaits, not `asyncio.wait()`.** `asyncio.wait` silently swallows exceptions unless you explicitly check results. `asyncio.gather` propagates errors.

```python
# WRONG — exceptions silently dropped
await asyncio.wait([asyncio.create_task(emit()), asyncio.create_task(save())])

# RIGHT — exceptions propagate
await asyncio.gather(emit(), save())
```

**Keep `deep_get`/`deep_set`/`deep_unset` as trivial dict traversals.** These run in the async event loop but are pure CPU (no I/O). They don't need `asyncio.to_thread()` — the overhead of thread dispatch far exceeds the cost of a dict walk.

### Frontend: React Components

**Wrap data-connected components in `React.memo()`.** Any component that reads from Zustand and renders inside a parent that re-renders frequently must be memoized. Without `memo()`, a parent re-render forces a full subtree rebuild even if props/state haven't changed.

```javascript
// WRONG — re-renders on every parent update
export default function PlayerSlot({ scoreboardNumber, teamNumber, playerNumber }) { ... }

// RIGHT — skips re-render when props unchanged
export default memo(function PlayerSlot({ scoreboardNumber, teamNumber, playerNumber }) { ... });
```

**Use a single `useShallow` selector per component, not N individual selectors.** Each `useStateStore()` call is a separate subscription. With 20 selectors in one component, a single state change can trigger 20 subscription checks. One shallow selector on the parent object does one check.

```javascript
// WRONG — 11 subscriptions, 11 equality checks per state change
const name = useStateStore(s => s?.score?.[sb]?.team?.[t]?.player?.[p]?.name ?? '');
const team = useStateStore(s => s?.score?.[sb]?.team?.[t]?.player?.[p]?.team ?? '');
// ... 9 more

// RIGHT — 1 subscription, shallow equality on the player object
const player = useStateStore(useShallow(
    s => s?.score?.[sb]?.team?.[t]?.player?.[p]
));
const name = player?.name ?? '';
const team = player?.team ?? '';
```

**Use `useMemo` for derived data.** Arrays and objects derived from state should be memoized to prevent unnecessary re-renders of child components that receive them as props.

### Frontend: SocketIO Events

**Handle `v1.state.set_batch` in all SocketIO consumers.** The backend emits batch events for HUD updates. The React frontend (`src/context/socket.jsx`) and all OBS overlay HTML files must handle this event alongside `v1.state.set`.

**Use `requestAnimationFrame` batching for incoming events.** Multiple SocketIO events arriving within a single frame (~16ms) are collected into pending arrays and flushed together in one Zustand `setItems()` call before paint.

### OBS Overlays

**Batch rendering in overlay HTML files.** When an overlay receives a `v1.state.set_batch` event, apply all items to local state first, then call the render function once — not once per item.
