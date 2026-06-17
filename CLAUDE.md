# CLAUDE.md — ProjectRioStreamHelper (PRSH)

## Project Overview

A web-based tournament stream overlay manager for **Mario Superstar Baseball (MSB)** via the Project Rio mod. Forked from TournamentStreamHelper (originally Qt/PySide6) and rebuilt as a single-game web app.

**Tech stack:** Python 3.12+, FastAPI + python-socketio, asyncio, orjson, watchfiles, pyrio (git dep), React 19 + Zustand + Mantine 7, Vite.

**Server:** `server/` — FastAPI + SocketIO on configurable port (default 5260).
**Frontend:** `src/` — React SPA served by FastAPI in production, Vite dev server in development.
**Builds:** PyInstaller (`PRSH.spec`) for standalone macOS `.app` and Windows `.exe`; Inno Setup (`installer/PRSH.iss`) for the Windows installer.

See [README.md](README.md) for end-user docs and the four scoreboard input methods explained from a user perspective.

---

## Glossary

These terms have specific meanings in this codebase. Use them precisely; correct an agent that drifts.

| Term | Meaning |
|------|---------|
| **Scoreboard** | A tab in the UI; one entry under `score.{N}` in state. N ≥ 1; multiple may be active simultaneously, including duplicates of the same source. |
| **Source** | A scoreboard's input mode. One of `Manual`, `HUD`, `Live API Game`, `Rotator`. Set in the score-controls panel. |
| **Side** | `1 = left`, `2 = right`. Used everywhere PRSH state references team position. Never use "away/home" in app vocabulary — Project Rio uses those internally but we translate. |
| **Team** | Synonymous with Side in state (`.player.{T}` where T∈{1,2}). |
| **Layout** | An HTML file under `public/layout/`, served as an OBS Browser Source. Declares its style contract via `<meta name="overlay-settings">` and its native size via `body { width/height }`. |
| **Layout type** | Derived from filename + group folder: `scoreboard`, `roster`, `stats`, `teamlogo`, `bracket`, `scene`, or the stem itself for standalone layouts. Drives `?size=` / `?team=` variant expansion. |
| **Scene** | A full 1920×1080 Layout under `public/layout/scenes/` designed to drop into an OBS scene as the entire stream canvas. |
| **Overlay** | Generic OBS Browser Source terminology. Not PRSH-specific; do not use as a synonym for any of the terms above. |
| **Size variant** | `?size=xs\|s\|m\|l\|xl` query param. Scoreboard layouts only. Maps to canonical (w,h) in `_SIZE_VARIANTS`. |
| **Team variant** | `?team=1\|2` query param. Applies to stats, roster, and teamlogo. |
| **Rotator (source)** | Scoreboard input method that cycles a scoreboard through a list of games at a configurable interval. |
| **Rotator (layout group)** | `public/layout/rotator/*.html` — standalone layouts (e.g., the results ticker) designed to display rotating content. Cooperates with but is distinct from the Rotator source. |
| **Rotation** | An in-flight cycling of games on a Rotator-source scoreboard, managed by `RotationManager`. No other meaning — there is no "player rotation" concept. |
| **Search set** | A labeled chip representing one completed-games API search (Username / Vs Username / Tags / Limit). Search sets stack additively in the Rotator panel. |
| **Game pool / Pool** | A set of game records (ongoing and/or completed) that a scoreboard, view, or rotation draws from. Two concrete pools: `OngoingGamePool` (live games from `/games/ongoing`) and `CompletedGamePool` (finished games from `/games`, populated by search sets). A Rotator-source scoreboard chooses via its **Pool selector**: `Both`, `Live Only`, or `Completed`. The Live API Game source reads from Ongoing only. |
| **HUD game** | Game data sourced from the local `decoded.hud.json` file. |
| **API game** | Game data sourced from `https://api.projectrio.app/`. |
| **Pinned player** | A name in settings that PRSH forces onto a chosen Side at the start of each new game. Configured in Settings → Project Rio. |
| **Stream labels** | Per-key `.txt` mirror of state under `user_data/stream_labels/`. Off by default. Intended for OBS Text Sources. |
| **Branding** | Single tournament logo asset uploaded by the user to `user_data/branding/`, served at `/branding/`. |
| **MSB assets** | User-supplied image pack at `user_data/game_assets/msb/{characterIcons,teamLogos,gameIcons}`. Validated against pyrio's canonical filename lists. PRSH does not ship these (Nintendo IP). |
| **Announcement** | Notification surfaced from GitHub: either an "Update available" synthesized from the Releases API, or an entry in `announcements.json` on the repo's `announcements` branch. |

---

## Architecture

### Core Data Flow

```
Project Rio Game ─→ decoded.hud.json ─→ HudWatcher (OS file events)
                                              │
Project Rio API ───→ OngoingGamePool  ──→ RioGameDataProvider ──→ State.SetBatch()
                └──→ CompletedGamePool ──→ RotationManager ─────┘        │
                                                                          ▼
                                                                  SocketIO + UI + OBS
                                                                          │
                                                       optional ───→ stream_labels/
```

### Module Organization

```
server/
├── __init__.py              # FastAPI app + SocketIO setup
├── server.py                # Static mounts + route registration
├── state.py                 # Central state store (Set, SetBatch, Save, Export)
├── settings.py              # Settings + Config persistence
├── paths.py                 # Path helpers (per-user writable root in frozen builds)
├── port_conflict.py         # Pre-flight port check + Tk recovery dialog (runs before async server)
├── tray.py                  # macOS/Windows system-tray icon (pystray)
├── win_window.py            # Windows: Tk taskbar window with server URL + Exit
├── announcements.py         # GitHub-driven announcement fetcher + version check
├── controller_overlay.py    # gc-overlay subprocess manager
├── api/v1/
│   ├── rio.py               # HUD game state, swap, refresh
│   ├── state.py             # Get/set state keys
│   ├── settings.py          # Get/set settings
│   ├── scoreboards.py       # Score control (swap, up/down)
│   ├── game_pool.py         # Completed/ongoing pool endpoints
│   ├── rotation.py          # Rotation control (start/stop/step/configure)
│   ├── stats.py             # Character stats
│   ├── layouts.py           # Layout metadata: type derivation, size/team variants, supportedSettings
│   ├── branding.py          # Tournament logos
│   ├── assets.py            # MSB image-pack validation against pyrio's canonical filenames
│   ├── startgg.py           # Start.gg bracket integration
│   ├── challonge.py         # Challonge bracket integration
│   ├── controller.py        # gc-overlay control
│   ├── announcements.py     # List active / dismiss announcements
│   └── logs.py              # In-app log viewer: list + tail
├── rio/
│   ├── provider.py          # RioGameDataProvider — HUD→State + side preservation
│   ├── hud_watcher.py       # HudWatcher — OS-level file watching via watchfiles
│   ├── stats_tracker.py     # StatsTracker — merges API historical + HUD current
│   ├── stats_api.py         # Project Rio API client
│   ├── game_pool.py         # OngoingGamePool / CompletedGamePool
│   ├── rotation.py          # RotationManager — per-scoreboard game rotation
│   └── pyrio/               # Git submodule (matt-gree/pyrio)
├── startgg/                 # Start.gg GraphQL provider + queries
├── challonge/               # Challonge REST provider
└── utils/
    ├── deep_dict.py         # deep_get/deep_set/deep_unset
    ├── json.py              # orjson wrapper with async threshold
    ├── router.py            # API decorator (@method)
    └── keyring.py           # OAuth token storage

src/                         # React frontend
├── main.jsx
├── components/
│   ├── App.jsx              # Root with error boundary
│   ├── providers.jsx
│   ├── SettingsModal.jsx
│   ├── LogsViewer.jsx       # In-app log viewer UI
│   ├── WelcomeCard.jsx      # First-launch / missing-assets prompt
│   ├── SupportLinks.jsx
│   ├── fields.jsx
│   └── scoreboard/          # PlayerSlot, TeamPanel, ScoreControls
├── context/
│   ├── store.jsx            # Zustand stores (state, settings, config, bracket)
│   ├── socket.jsx           # SocketIO provider with RAF batching
│   └── announcements.jsx
├── routes/
│   ├── root.jsx
│   ├── scoreboard_manager/  # Per-scoreboard source UI + Rotator panel
│   ├── layouts/             # Layout catalog + per-layout settings + Design tab
│   ├── bracket/             # In-app bracket view
│   ├── tournament_info/
│   ├── commentary/
│   └── player_list/
├── hooks/                   # useStartGG, useTournament
├── data/                    # msb.js (character/team static data)
└── lang/

public/
├── layout/                  # OBS browser source HTML files (see "Layouts" below)
│   ├── scoreboard1/         # scoreboard.html (size variants), roster/stats/teamlogo (team variants)
│   ├── bracket/             # index/winners_only/losers_only/player_schedule
│   ├── scenes/              # Full 1920×1080 scene overlays (NNL, rivalry)
│   ├── rotator/             # Rotation-display layouts (ticker)
│   ├── controller/          # Per-team controller-input overlay (?team=1|2; iframes the running gc-overlay at the side's HUD port)
│   ├── preview/             # Sample state JSON blobs for in-app preview rendering
│   └── lib/overlay-base.js  # Shared SocketIO client + setting resolution
├── game_assets/             # (dev-mode only — frozen builds use user_data)
└── favicon.png, logo*.png

user_data/
├── settings.json            # User preferences
├── state.json               # Persisted application state
├── stream_labels/           # Exported state as text files (off by default)
├── branding/                # Tournament logo (served at /branding/)
└── game_assets/msb/         # User-supplied image pack (characterIcons/, teamLogos/, gameIcons/)
```

In **frozen builds**, `user_data/` lives under the per-user writable root resolved by `server/paths.py` (e.g., `~/Library/Application Support/PRSH/user_data/` on macOS, `%LOCALAPPDATA%\PRSH\user_data\` on Windows). In **dev mode** it's `./user_data/` next to the repo.

---

## Singleton Pattern

The server uses class-level singletons with `@classmethod` methods. State is shared via class variables.

| Class | Purpose |
|-------|---------|
| `State` | Central state store — in-memory dict + SocketIO broadcast + file export |
| `Settings` | User settings persistence (`user_data/settings.json`) |
| `Config` | Application config (server URL, version) |
| `RioGameDataProvider` | HUD watcher lifecycle + game data parsing + side preservation |
| `StatsTracker` | Per-character stats merging (API historical + HUD current game) |
| `HudWatcher` | File watcher (owned by RioGameDataProvider) |
| `OngoingGamePool` / `CompletedGamePool` | Game pools from Project Rio API |
| `RotationManager` | Per-scoreboard game rotation (Rotator source) |
| `StartGGProvider` / `ChallongeProvider` | Bracket/tournament data |
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

### MSB State Keys

```
score.{N}.inning, score.{N}.half_inning
score.{N}.outs, score.{N}.strikes, score.{N}.balls
score.{N}.batter, score.{N}.pitcher
score.{N}.cbRioRunnerOn1/2/3                          (booleans)
score.{N}.star_chance, score.{N}.stadium             (slug), score.{N}.innings_selected
score.{N}.tag_set                                     (game-mode id of the live game)
score.{N}.away_linescore, score.{N}.home_linescore   (per-inning runs; live + final)
score.{N}.player.{T}.rioName                          (T ∈ {1,2}: 1 = left, 2 = right)
score.{N}.player.{T}.rio_captainIndex
score.{N}.player.{T}.msb_team                         (roster-derived team name, team_name_algo)
score.{N}.player.{T}.logo                             (explicit in-game banner; may differ from msb_team)
score.{N}.player.{T}.port                             (0-indexed controller port, HUD only)
score.{N}.player.{T}.team_stars                       (team star-meter count)
score.{N}.player.{T}.character.{C}                    (roster of 9; .name/.position/.is_starred/.batting_hand/.fielding_hand)

scoreboards.active                                    (list of active scoreboard N's)
scoreboards.sources.{N}.type                          (manual | hud | live_api | rotator)
scoreboards.rotation.{N}.*                            (live rotation status for overlays)
```

---

## Layouts — Type System and Style Contract

Each Layout (HTML file under `public/layout/`) is enumerated by `server/api/v1/layouts.py`, which:

1. **Derives a layout type** from the filename stem and group folder. `scenes/*` → `scene`; `bracket/*` → `bracket`; otherwise strips trailing digits from the stem.
2. **Expands variants** if applicable:
   - **Size variants** (`?size=xs..xl`) — scoreboard only. Maps to canonical pixel dimensions.
   - **Team variants** (`?team=1|2`) — stats, roster, teamlogo.
3. **Parses `body { width/height }`** for the OBS browser-source size hint. Bracket falls back to 1920×1080.
4. **Parses `<meta name="overlay-settings">`** — the layout's whitelist of style knobs it respects.

### Style settings: two-tier system

Defined in `src/routes/layouts/layouts.jsx`:

- **`GLOBAL_DESIGN_KEYS`** + **`GLOBAL_DESIGN_DEFAULTS`** — globally-themed knobs (accentColor, cardBg, textColor, borderRadius, borderColor, borderWidth, fontFamily, shadow knobs, showCaptains, showLogo, showBackdropBlur, finalBadgeColor). Live in state at `overlays.global.*` and apply to every layout that opts in via its `<meta>` whitelist.
- **`LAYOUT_SETTINGS[layoutType]`** — per-layout-type element settings (e.g., `showElo` for scoreboard, `connectorColor` for bracket). Live at `overlays.{type}.{key}`.
- **`OVERRIDABLE_GLOBAL_KEYS`** — globals that a specific layout type can *pin* an override for (e.g., make bracket use a different accent than the rest of the design system).

The HTML's `<meta name="overlay-settings" content="...">` is the source of truth for what the Layouts tab is allowed to expose for that file. The UI never offers a control the layout didn't opt into.

### Adding a new Layout — checklist

1. Drop the HTML file in the appropriate `public/layout/<group>/` folder.
2. Set `body { width: _px; height: _px }` to the native size.
3. Declare every style knob the layout respects in `<meta name="overlay-settings" content="...">`.
4. If the layout introduces a **new element-only setting**, add a def to `LAYOUT_SETTINGS[layoutType]` in `layouts.jsx`.
5. If the layout introduces a **new globally-themable knob**, add it to `GLOBAL_DESIGN_KEYS`, `GLOBAL_DESIGN_DEFAULTS`, and `OVERRIDABLE_GLOBAL_KEYS`.
6. Subscribe to `v1.state.set` **and** `v1.state.set_batch` via `overlay-base.js`. Batch your rendering.
7. Use `?scoreboard=N` to bind scoreboard data (default `1`). Use `?size=` / `?team=` if the file is a variant template.

### Default scoreboard binding

`scoreboard.html` reads `parseInt(params.get('scoreboard')) || 1` — **a missing `?scoreboard=` defaults to scoreboard 1**, not "the active one" or "the first present." At least one scoreboard always remains in the UI, so this is safe by construction.

---

## Multi-Scoreboard Rules

- Each scoreboard's source is independent.
- Multiple scoreboards may share a source type (two HUD-sourced scoreboards will mirror the same HUD; two Rotator sources can each rotate through their own pool with their own interval).
- **Pinned player applies globally** — it's a Settings value, not per-scoreboard. Every HUD-sourced scoreboard honors the same pin.
- A scoreboard can be renamed (alias appears in tab and is referenceable from layouts). It can be removed; at least one always remains.
- Each Layout binds to a specific scoreboard via `?scoreboard=N` (default `1`).

---

## Player-Side Preservation (HUD Source)

When the same streamer plays back-to-back HUD games, Project Rio randomly assigns them to away or home each game. PRSH normalizes this via `_preserve_player_sides()` in `server/rio/provider.py`. The logic is a state machine with two flags (`_sides_swapped`, `_user_overridden`), not a strict priority cascade:

**At game start (inning resets), both flags clear; then:**
1. **Pinned player wins outright.** If the pinned name appears in either roster, set sides so the pin lands on the configured Side. Back-to-back is not consulted.
2. **Back-to-back fallback.** Only if no pin matched: check the previous game's player→Side map; if a returning player switched, swap.

**Mid-game (subsequent HUD events in the same game):**
- The **manual swap button** is the only signal that re-fires; it sets `_user_overridden`.
- Manual override scope: **current game only.** A detected new game (inning reset) clears it.
- Special case: if the user manually swaps back to the orientation the pin would have chosen, `_user_overridden` clears so the next new game re-applies the pin cleanly.

**Settings keys:**
- `project_rio.pinned_player` — player name to pin.
- `project_rio.pinned_side` — `"Team 1"` or `"Team 2"`.
- `project_rio.pinned_hud_only` — only apply pin to HUD-sourced scoreboards.

---

## Rotations (Rotator Source)

`server/rio/rotation.py` — one `RotationState` per scoreboard, keyed by scoreboard number.

- Owns: game-id list, advance interval, pool selector (`both | live | completed`), current index.
- Pre-fetches stats for every game in the rotation at start so transitions don't block on the API.
- On a per-game apply failure: logs a warning and advances; never kills the rotation.
- Live status is mirrored into State at `scoreboards.rotation.{sb_id}.*` so any overlay can subscribe like normal state.
- **Resume-on-startup:** rotations active at shutdown re-fetch their pool and restart in the background on next launch. Only resumes if (a) the scoreboard still exists, (b) its current source is still `rotator`, and (c) `enabled=true` with a non-empty `game_ids`.

---

## Web Server (Port 5260)

FastAPI + python-socketio.

### Networking

- Default bind: **`127.0.0.1` (loopback only).** This is intentional: PRSH serves stateful APIs that mutate the live stream, and binding to all interfaces by default would let anything on the LAN (or open Wi-Fi) push fake state, change scoreboards mid-broadcast, or harvest data.
- LAN access is opt-in via `server.allow_lan` (Settings). When true, binds `0.0.0.0`. Use for legitimate multi-machine setups (separate streaming PC).
- `server/port_conflict.py` runs **synchronously before the async server** and reads `settings.json` directly (the async Settings class isn't initialized yet). On conflict, a Tk modal offers auto-retry on the next free port (persists), reveal-settings-folder, or quit.

### Static Mounts

- `/assets/` — React build output
- `/game_assets/` — character icons, team logos (resolved from `user_data/game_assets/msb/` in frozen builds, `./public/game_assets/` in dev)
- `/layout/` — OBS browser source HTML
- `/branding/` — tournament logo

### Key API Routes (`/api/v1/`)

| Endpoint | Purpose |
|----------|---------|
| `GET /state` | Full state JSON |
| `GET/PUT /state/{key}` | Get/set individual state key |
| `GET/PUT /settings/{key}` | Get/set settings |
| `GET /rio/game` | Current HUD game state |
| `POST /rio/refresh` | Re-read HUD file |
| `POST /rio/swap` | Toggle team sides (sets `_user_overridden`) |
| `GET /scoreboards` | Active scoreboards |
| `GET /layouts` | Available layouts (with type/variants/supportedSettings/dims) |
| `GET /games`, `GET /games/ongoing` | Game pool endpoints |
| `POST /rotation/...` | Configure/start/stop/step a scoreboard's rotation |
| `POST /tournament/startgg` | Load Start.gg bracket by slug |
| `POST /tournament/challonge` | Load Challonge bracket |
| `GET/POST /controller` | gc-overlay status & control |
| `GET /announcements`, `POST /announcements/dismiss` | Active announcements + per-id dismissal |
| `GET /logs`, `GET /logs/{name}` | Log file list + tail |
| `GET /assets/msb/validate` | MSB image-pack validation report |

### SocketIO Events

- `v1.state.set` / `v1.state.set_batch` — state updates (server → clients). **Every consumer must handle both.**
- `v1.settings.set` — settings updates (bidirectional).
- `v1.state.get` — client requests full state on connect.

---

## Tournament Brackets

Both providers are thin pass-throughs that load remote bracket data and broadcast it to the in-app Bracket view and the `public/layout/bracket/` overlays. Recent work has been on the **rendering** side (Swiss/round-robin layouts, bye scaling, connector geometry, default size), not on the data layer.

- **Start.gg** — GraphQL via `StartGGProvider`. Load by tournament slug.
- **Challonge** — REST via `ChallongeProvider`. Requires API key + Admin membership in the Mario Superstar Baseball Netplay Events Challenge community. May be deprecated; layout accuracy is best-effort.

---

## Announcements

`server/announcements.py` pulls two sources from GitHub and merges them into a unified feed:

1. **Release check** — `GET /repos/{repo}/releases/latest`. A newer tag than the running version synthesizes an "Update available" entry.
2. **`announcements.json`** — raw file on the repo's dedicated `announcements` branch. Each entry supports `id`, `title`, `body`, `severity` (info/warn/error/success), `min_version` / `max_version`, `expires_at`, `link_url`, `link_text`.

Per-user dismissals are stored in `settings.announcements.dismissed_ids`. Triggered by the maintainer via a GitHub action; no need for a release to ship a notification.

---

## Logs

In-app log viewer (`LogsViewer.jsx` + `server/api/v1/logs.py`). Lists rotated log files in the per-user logs dir (resolved via `server/paths.py`) with size + mtime; supports tailing by filename with path-traversal guards. Useful for end-user troubleshooting without asking them to find the logs folder.

---

## Controller Overlay (gc-overlay)

`ControllerOverlay` manages an optional subprocess that draws controller inputs as a separate OBS browser source.

- Auto-detects as sibling `../gc-overlay/` directory or inside the frozen bundle.
- Custom path via Settings → Controller Overlay.
- Runs on its own port (default 8069), serves its own WebSocket + HTML.
- Settings: `controller_overlay.path`, `.port`, `.controller`, `.auto_start`.

**Per-team (home/away) follow.** gc-overlay shows one controller per browser source, selectable via `?port=N` (0-indexed) or a runtime `{port}` WebSocket message. The HUD reports each player's controller port (`Away Port`/`Home Port`), which `provider.py` writes to `score.{N}.player.{T}.port`. The `public/layout/controller/controller.html` wrapper (`?team=1|2&scoreboard=N`) reads that port from PRSH state and iframes the running gc-overlay at the matching port, reloading only when the port changes — so a "left/right controller" browser source follows whoever is on that side. The side→port mapping lives entirely in PRSH; gc-overlay is unmodified.

---

## HUD → Web Stats Auto-Fetch

The HUD file now carries `TagSetID` (the game mode being played). On a new HUD game, `RioGameDataProvider._apply_hud_game_mode()` resolves it to the game-mode name and writes `scoreboards.sources.{sb}.stats_tag` for every HUD-target scoreboard — which both drives the automatic stats fetch and visually updates the per-scoreboard game-mode selectbox. This mirrors the live-API assignment path, which already sets `stats_tag` from the assigned game's mode. A manual selection is overwritten on each new game start.

---

## Platform-Specific Startup

- **macOS** — system-tray icon (`tray.py`, pystray) holds the process; no visible window.
- **Windows** — `win_window.py` opens a Tk window in the taskbar with app name, version, clickable server URL, and a graceful exit button. This is the only way for end users to close the app cleanly on Windows.
- **Both** — `port_conflict.py` runs first; if 5260 (or the configured port) is taken, the user gets a Tk dialog before the server attempts to bind.

---

## MSB Image Assets

PRSH does not ship MSB images (Nintendo IP). Users provide an asset pack under `user_data/game_assets/msb/{characterIcons,teamLogos,gameIcons}`. `server/api/v1/assets.py` validates the folder against pyrio's canonical filename lists per category and surfaces missing files in **Settings → Project Rio → MSB Image Assets** and on the first-launch Welcome card.

- Custom location override: `settings.assets.msb_path`.
- Default path: per-user writable root, resolved by `default_msb_assets_dir()`.

---

## Build & Run

### Development

```bash
npm run setup          # macOS/Linux — npm install + venv + poetry install + build
npm run setup:win      # Windows

npm run dev            # macOS/Linux — Vite + FastAPI concurrently
npm run dev:win        # Windows
```

- Vite: http://localhost:5173 (HMR)
- FastAPI: http://localhost:5260 (`TSH_DEV=1` enables CORS for Vite)

### Production

```bash
npm run build          # Build React → dist/
python main.py         # Serve everything on :5260
```

### Frozen Builds

```bash
npm run build
pyinstaller PRSH.spec
```

- macOS: `dist/PRSH.app/`
- Windows: `dist/PRSH/PRSH.exe`, then `installer/PRSH.iss` → `PRSH-Setup.exe`

`scripts/freeze-version.py` runs in `prebuild` to bake the version into the bundle.

### HUD File Default Paths

- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `%APPDATA%\Project Rio\HudFiles\decoded.hud.json`
- Override: Settings → Project Rio → HUD File Path

---

## Testing

No automated test suite. Manual smoke test:
1. `npm run dev`
2. React UI loads without console errors at http://localhost:5173.
3. `localhost:5260/api/v1/state` returns valid JSON.
4. HUD file watching: modify `decoded.hud.json` and confirm scoreboard updates.
5. OBS layout: add browser source pointing at `localhost:5260/layout/scoreboard1/scoreboard.html?scoreboard=1`.
6. Tournament loading: Start.gg slug, or Challonge URL + API key.

**Important:** layout HTML and `overlay-base.js` are static — no build step. After editing, **hard refresh** the browser source (Cmd/Ctrl+Shift+R). Safari may also need Option+Cmd+E first.

### Clearing Cached State

If the app fails to launch due to corrupt `user_data/state.json`:

```bash
echo '{}' > user_data/state.json
```

---

## Key Files for Common Tasks

| Task | Files |
|------|-------|
| Change HUD game parsing | `server/rio/provider.py`, `server/rio/hud_watcher.py` |
| Side preservation logic | `server/rio/provider.py` (`_preserve_player_sides`) |
| Add/modify state keys | `server/state.py`, `src/context/store.jsx` |
| Add API endpoints | `server/api/v1/` (decorate with `@method`) |
| Modify settings schema | `server/settings.py` (defaults), `src/components/SettingsModal.jsx` |
| Rotation behavior | `server/rio/rotation.py`, `server/api/v1/rotation.py` |
| Add/modify Layout | `public/layout/<group>/`, register knobs in `src/routes/layouts/layouts.jsx` |
| Add/modify Scene | `public/layout/scenes/` (must be 1920×1080) |
| Tournament integrations | `server/startgg/`, `server/challonge/` |
| Bracket rendering | `public/layout/bracket/`, `src/routes/bracket/` |
| Controller overlay | `server/controller_overlay.py`, `server/api/v1/controller.py` |
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
- **One `useShallow` Zustand selector per component** — combine subscriptions:

  ```js
  const player = useStateStore(useShallow(
      s => s?.score?.[sb]?.team?.[t]?.player?.[p]
  ));
  ```

- **`useMemo` for derived data passed as props.**

### SocketIO + Overlays

- **Handle both `v1.state.set` and `v1.state.set_batch`** in every consumer.
- **`requestAnimationFrame` batching** — events within one frame flush as a single Zustand update.
- **Layouts: apply all batch items to local state first, render once.**

---

## Known Limitations

- Full state is sent on initial WebSocket connect (incremental after that).
- `pandas` is ~50MB but required by pyrio.
- No automated tests.
- Bracket rendering for Challonge is best-effort; not guaranteed accurate.
