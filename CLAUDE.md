# CLAUDE.md — TournamentStreamHelper (MSB Fork)

## Project Overview

This is a fork of TournamentStreamHelper (TSH), a Qt6/PySide6 desktop application for managing tournament stream overlays in OBS. This fork is **specifically adapted for Mario Superstar Baseball (MSB)** via the Project Rio mod. The upstream TSH supports 90+ fighting games; this fork strips that to focus on a single game.

**Tech stack:** Python 3.10+, PySide6 (via `qtpy`), Flask + Flask-SocketIO, qasync, orjson, pyrio (custom library)

**Entry point:** `main.py` → sets `QT_API=pyside6`, creates `qasync.QEventLoop`, instantiates `src.Window()`

---

## Architecture

### Core Data Flow

```
Project Rio Game → decoded.hud.json → RioHUDWatcher → RioGameDataProvider
                                                            ↓
Project Rio API ─────────────────────────────────→ RioGameDataProvider
                                                            ↓
                                                   TSHScoreboardWidget
                                                            ↓
                                                      StateManager
                                                       ↓        ↓
                                              ./out/ files   WebServer (SocketIO :5000)
                                                       ↓        ↓
                                                OBS text sources  OBS browser sources
```

### Module Organization

```
src/
├── TournamentStreamHelper.py   # Main window (Window class), app entry
├── StateManager.py             # Central state → JSON export + SocketIO broadcast
├── SettingsManager.py          # User settings persistence (./user_data/settings.json)
├── RioGameDataProvider.py      # Project Rio HUD watcher + API integration
├── TSHScoreboardWidget.py      # Main scoreboard UI (score, inning, runners, etc.)
├── TSHScoreboardPlayerWidget.py # Per-player widget (name, characters, captain, country)
├── TSHScoreboardManager.py     # Manages multiple scoreboard tabs
├── TSHScoreboardStageWidget.py # Stage/ruleset configuration
├── TSHGameAssetManager.py      # Game asset loading (characters, stages, icons)
├── TSHPlayerDB.py              # Local player database (CSV-backed)
├── TSHWebServer.py             # Flask + SocketIO server (port 5000)
├── TSHWebServerActions.py      # Web endpoint action handlers
├── TSHSelectSetWindow.py       # Match selection dialog
├── TSHBracketWidget.py         # Bracket display and management
├── TSHCommentaryWidget.py      # Commentator info management
├── TSHPlayerListWidget.py      # Player list entry UI
├── TSHPlayerList.py            # Base player list container
├── TSHPlayerListSlotWidget.py  # Individual player slot
├── TSHTournamentInfoWidget.py  # Tournament metadata display
├── TSHThumbnailSettingsWidget.py # YouTube thumbnail generation (optional)
├── TSHNotesWidget.py           # Free-form notes (4 slots)
├── TSHAboutWidget.py           # About dialog
├── TSHAlertNotification.py     # App alert system (fetches from GitHub)
├── TSHAssetDownloader.py       # Game asset download manager
├── TSHHotkeys.py               # Global keyboard shortcuts (pynput)
├── Workers.py                  # QRunnable-based worker pattern
├── Helpers/
│   ├── TSHCountryHelper.py     # US/CA country+state data (simplified from 37MB JSON)
│   ├── TSHDictHelper.py        # deep_get/deep_set/deep_clone utilities
│   ├── TSHDirHelper.py         # Path resolution (PyInstaller support)
│   ├── TSHLocaleHelper.py      # Internationalization/translations
│   ├── TSHControllerHelper.py  # Controller database
│   └── TSHBadWordFilter.py     # Profanity filter (trie-based)
├── TournamentDataProvider/
│   ├── __init__.py             # Base TournamentDataProvider class
│   ├── StartGGDataProvider.py  # start.gg GraphQL API integration
│   └── ChallongeDataProvider.py # Challonge API integration
├── Settings/
│   └── TSHSettingsWindow.py    # Settings dialog
└── layout/                     # Qt Designer .ui files
    ├── TSHScoreboardScore.ui   # 588 lines — score entry (largest game UI)
    ├── TSHScoreboardPlayer.ui  # 309 lines — player data entry
    ├── TSHScoreboardStage.ui   # 445 lines — stage strike
    ├── TSHScoreboardTeam.ui    # 214 lines — team display
    ├── TSHThumbnailSettings.ui # 1184 lines — thumbnail config (largest overall)
    ├── TSHCommentary.ui        # 118 lines
    ├── TSHCommentator.ui       # 254 lines
    ├── TSHBracket.ui           # 213 lines
    ├── TSHTournamentInfo.ui    # 224 lines
    └── TSHAbout.ui             # 93 lines
```

### Assets Structure

```
assets/
├── rio_teamLogos/          # 6.2 MB — 50 MSB team logo PNGs
├── rio_characterIcons/     # 396 KB — 56 character portrait PNGs
├── rio_scoreboard/         # 7.6 MB — Runner base graphics, baseball bat, ball
├── country_flag/           # Country flag PNGs (us.png, ca.png, etc.)
├── state_flag/US/          # US state flag PNGs
├── state_flag/CA/          # Canadian province flag PNGs
├── icons/                  # UI icons (SVG)
├── characters.json         # 3.5 MB — start.gg character mappings (cached)
└── versions.json           # App version info

user_data/
├── games/msb/base_files/   # MSB game config (config.json + character variants)
├── settings.json           # User preferences
├── local_players.csv       # Player database
├── pronouns_list.txt       # Pronoun autocomplete list
├── additional_flag/        # Custom flag images
└── alerts_red.json         # Dismissed alert IDs

out/                        # Exported state (consumed by OBS)
├── program_state.json      # Full state dump
└── score/1/team/1/...      # Individual text/image files per state key
```

---

## Singleton Pattern

The app uses class-level singletons created at **module import time**. This is a fundamental architectural constraint — these run before `Window.__init__`:

| Singleton | Created | What Happens at Import |
|-----------|---------|----------------------|
| `SettingsManager` | `SettingsManager.py:46` | Loads `settings.json` from disk |
| `StateManager` | `StateManager.py:294` | Creates `./out/`, loads `program_state.json` |
| `TSHScoreboardManager.instance` | `TSHScoreboardManager.py:98` | Creates QTabWidget |
| `TSHGameAssetManager.instance` | `TSHGameAssetManager.py:1138` | Empty init (loading deferred) |
| `TSHAlertNotification.instance` | `TSHAlertNotification.py:116` | Connects signals |
| `TSHTournamentDataProvider.instance` | `TSHTournamentDataProvider.py:408` | Creates thread pool |
| `TSHCountryHelper.instance` | `TSHCountryHelper.py:229` | Builds US/CA model (inline data) |
| `TSHHotkeys.instance` | `TSHHotkeys.py:112` | Loads user hotkey config |
| `RioGameDataProvider.instance` | `RioGameDataProvider.py:276` | Starts HUD file watcher |

**Implication:** Import order matters. Circular imports are avoided by deferring some imports. All singletons share state via class variables, not instance variables.

---

## StateManager — The Central Nervous System

Every UI change flows through `StateManager.Set(key, value)`. This:
1. Updates the in-memory `state` dict
2. Schedules a **debounced save** (50ms)
3. On save: computes `DeepDiff` against last saved state
4. Exports changed keys as individual files in `./out/`
5. Broadcasts full state via SocketIO to web clients

**Key patterns:**
- `StateManager.BlockSaving()` / `ReleaseSaving()` — bracket saves during batch updates
- `StateManager.Set("score.1.team.1.teamName", "Player1")` — dot-notation keys
- Text values → `./out/score/1/team/1/teamName.txt`
- File paths (`./foo.png`) → copied to `./out/`
- HTTP image URLs → downloaded async, saved to `./out/`

---

## Rio/MSB Integration

### Data Sources
1. **Local HUD file** (`decoded.hud.json`) — watched by `RioHUDWatcher` with `QFileSystemWatcher` + 100ms debounce
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

## Web Server (Port 5000)

Flask + SocketIO, runs in QThread. Key endpoints:
- `GET /program-state` — full state JSON
- `GET /ruleset` — current match ruleset
- Score control: `/scoreboard1-team1-scoreup`, `-scoredown`, `-swap-teams`
- Set management: `/get-sets`, `/load-set?set=<id>`
- Stage strike: `/scoreboard1-stage-<action>`
- Commentary: `/update-commentary-<N>`, `/get-comms`
- Bracket: `/update-bracket`

All mutations emit Qt signals that are handled on the main thread.

---

## Player Widget Hierarchy

Each scoreboard creates **2 teams × N players × 9 character slots**:

```
TSHScoreboardWidget
├── team1column (QWidget from TSHScoreboardTeam.ui)
│   └── QScrollArea → QVBoxLayout
│       └── TSHScoreboardPlayerWidget × playerCount
│           ├── QLineEdit: name, team, real_name, twitter, pronoun, rioName
│           ├── QComboBox: country, state, msb_team, controller
│           ├── QPlainTextEdit: custom_textbox
│           └── character_elements × 9:
│               ├── QComboBox: character selection
│               ├── QComboBox: color/skin selection
│               ├── QComboBox: variant (hidden for MSB)
│               ├── QRadioButton: captain selector
│               └── QPushButton × 2: move up/down
├── scoreColumn (QWidget from TSHScoreboardScore.ui)
│   ├── QSpinBox: score_left, score_right, best_of, inning, outs, strikes, balls
│   ├── QComboBox: phase, match, half_inning, batter, pitcher
│   └── QCheckBox: cbRioRunnerOn1/2/3
└── team2column (same as team1column)
```

**Widget count per scoreboard:** ~373 QWidget objects (125 per player widget due to 9 char slots × ~10 widgets each, plus score/team controls)

---

## Threading Model

The app mixes three threading paradigms:
1. **QThread** — WebServer, update checker, layout downloader, game asset loader
2. **QThreadPool + QRunnable (Workers.py)** — API calls, data fetches
3. **Python threading.Thread** — StateManager export, image downloads, debounce timers

**Critical shared lock:** `TSHScoreboardPlayerWidget.dataLock` is a **CLASS variable** (shared by all 18 player widget instances). This is a known architectural issue.

**GIL consideration:** Python's GIL means threads don't achieve true parallelism for CPU work, but they do help with I/O-bound operations (network, file writes).

---

## Known Limitations & Technical Debt

### Architectural
- **Class-level mutable state**: `dataLock`, `signals`, `characterModel` are CLASS variables shared across all instances of `TSHScoreboardPlayerWidget`
- **Singleton anti-pattern**: 9+ singletons created at import time, not thread-safe construction
- **Mixed threading**: QThread + threading.Thread + QThreadPool used inconsistently
- **No dependency injection**: All singletons accessed via `ClassName.instance`

### Performance (Mitigated)
- **StateManager debouncing** (50ms) — prevents I/O storms on rapid changes
- **SettingsManager debouncing** (200ms) — prevents disk thrashing
- **Signal cascade guards** — `_initializing` and `_building_characters` flags prevent init storms
- **Country data simplified** — US/CA inline data replaces 37MB JSON (saves ~200MB RAM)
- **Lookup caching** — single pyrio `Lookup()` instance instead of one per character
- **Background startup** — update checks, layout downloads moved off main thread

### Remaining Concerns
- `deep_clone()` in TSHDictHelper uses msgpack `packb()/unpackb()` — called on every state save
- WebServer broadcasts **entire state** on every change (no delta protocol)
- `QCoreApplication.processEvents()` still used in some paths (potential reentrancy)
- Controller database download (50-100MB) happens on init if not cached
- Some web action handlers use blocking `QEventLoop().exec_()` pattern

---

## Build & Run

```bash
# Install dependencies
pip install -r dependencies/requirements.txt

# Run the application
python main.py
```

**Dependencies:** PySide6, qasync, flask, flask-socketio, requests, orjson, deepdiff, loguru, pynput, Pillow, py7zr, msgpack, pyrio (git submodule)

**Platform paths for HUD file:**
- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `~/Documents/Project Rio/HudFiles/decoded.hud.json`
- Or set custom path in Settings → Project Rio → HUD File Path

---

## Testing

No automated test suite exists. Manual testing:
1. Launch with `python main.py`
2. Verify scoreboard loads without errors in terminal
3. Check `localhost:5000/program-state` returns valid JSON
4. Test HUD file watching by modifying `decoded.hud.json`
5. Test API integration via "Load Live Games" button

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
| Add new MSB UI elements | `TSHScoreboardWidget.py`, `layout/TSHScoreboardScore.ui` |
| Change game data parsing | `RioGameDataProvider.py` |
| Modify state export format | `StateManager.py` |
| Add web API endpoints | `TSHWebServer.py`, `TSHWebServerActions.py` |
| Change player widget fields | `TSHScoreboardPlayerWidget.py`, `layout/TSHScoreboardPlayer.ui` |
| Modify settings | `Settings/TSHSettingsWindow.py`, `SettingsManager.py` |
| Update character data | `user_data/games/msb/base_files/config.json` |
| Add/modify team logos | `assets/rio_teamLogos/` |
