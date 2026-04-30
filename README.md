# ProjectRioStreamHelper (PRSH)

A web-based tournament stream overlay manager for **Mario Superstar Baseball (MSB)** played through the [Project Rio](https://www.projectrio.online/) emulator. PRSH runs locally on the streamer's machine, exposes a web UI for managing scoreboards, and serves OBS browser-source overlays that update in real time.

PRSH is forked from [TournamentStreamHelper](https://github.com/joaorb64/TournamentStreamHelper) and rebuilt as a single-game web app on FastAPI + React.

---

## Quick Start

### Install (end users)

Pre-built installers are produced from `PRSH.spec` (PyInstaller) and `installer/PRSH.iss` (Inno Setup, Windows):

- **macOS** — `dist/PRSH.app`
- **Windows** — `dist/PRSH/PRSH.exe` (or the Inno Setup installer)

Launch the app, then open `http://localhost:5260` in any browser. A system-tray icon stays running while the server is up.

### Run from source

```bash
# One-time setup
npm run setup          # macOS / Linux
npm run setup:win      # Windows

# Dev mode (Vite HMR + FastAPI)
npm run dev            # macOS / Linux
npm run dev:win        # Windows
```

- React UI: `http://localhost:5173` (Vite, HMR)
- API + SocketIO + production SPA: `http://localhost:5260`

---

## Required: MSB Image Assets

PRSH does **not** ship Mario Superstar Baseball images (Nintendo IP). Without them, the UI and overlays will render with broken images. You need to supply the asset folder yourself before the app is usable.

**Where to put it.** PRSH looks for assets in a writable folder under your user data directory:

- **macOS** — `~/Library/Application Support/PRSH/user_data/game_assets/msb/`
- **Windows** — `%LOCALAPPDATA%\PRSH\user_data\game_assets\msb\`
- **Run from source** — `./user_data/game_assets/msb/`

The folder is created automatically on first launch. Drop your asset pack inside so the layout looks like:

```
.../user_data/game_assets/msb/
├── characterIcons/    *.png — one per character (54)
├── teamLogos/         *.png — one per in-game team name (48)
└── gameIcons/         bat.png, glove.png, superstar.png
```

**Settings → Project Rio → MSB Image Assets** validates the folder against the canonical filename lists from [pyrio](https://github.com/matt-gree/pyrio) and shows exactly what's missing per category.

The fastest way to find the folder is **Settings → Project Rio → MSB Image Assets → Open Folder**, which reveals it in Finder/Explorer. The Welcome screen also shows whether assets were found on first launch.

**Custom location.** If you keep a shared asset pack for use across multiple tools, point PRSH at it via **Settings → Project Rio → MSB Image Assets → Browse...** and select your folder. The override persists in `settings.json`.

---

## How It Works

The web UI shows one or more **scoreboards**. Each scoreboard is an independent set of state keys (teams, players, score, inning, runners, etc.) that can be populated from one of four input methods. The same state drives both the in-app UI and the OBS browser-source overlays in `public/layout/`.

State changes flow through a single store (`server/state.py`) that broadcasts diffs over SocketIO and optionally (toggle in settings) exports each value as a text file under `user_data/stream_labels/` for use as OBS Text Sources.

---

## Input Methods

Each scoreboard has a **Source** dropdown (in the score-controls panel) with four options. Switching source changes which inputs are active and which side panel appears.

### 1. Manual

You type or click everything yourself: player names, characters, score, balls/strikes/outs, runners on base, captains, superstars. Nothing is read from the game. Use this when there's no live HUD file (e.g., reviewing a recorded set, or operating a scoreboard for a remote player).

All scoreboard fields are editable in this mode.

### 2. HUD (live local game)

PRSH watches Project Rio's `decoded.hud.json` file and pushes every change into the scoreboard in real time — score, inning, half-inning, batter/pitcher, balls/strikes/outs, runners on base, character stats. This is the right mode when *you* are running the Project Rio client locally.

**HUD file default paths (auto-detected):**
- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `%APPDATA%\Project Rio\HudFiles\decoded.hud.json`
- Override for custom path located in Settings

The watcher uses OS-level file events (kqueue / inotify / ReadDirectoryChanges via `watchfiles`), so there's no polling cost between game updates.

**Side preservation.** Project Rio randomly assigns away/home each game. PRSH keeps the same player on the same side across back-to-back games via three layers:
1. **Pinned player** (Settings → Project Rio) — always force a named player onto Team 1 or Team 2.
2. **Back-to-back detection** — if a returning player switched sides, auto-swap.
3. **Manual swap button** — persists for the rest of the current game.

Player text fields (full name, country, pronoun, social handles) remain manually editable in HUD mode; only the Rio-supplied fields lock to the game.

### 3. Live API Game

Pulls active games from the Project Rio API (`https://api.projectrio.app/`) instead of from a local HUD file. Use this for **remote** matches you're casting — pick the game from a searchable list and PRSH polls the API to keep the scoreboard live.

**Populating the list (right-side panel when source is "Live API Game"):**
- **Refresh** — fetch the current set of ongoing games once.
- **Auto-poll** — keep refreshing on an interval (default 10 s, configurable 5–300 s). When auto-poll is on, the currently loaded game also gets re-applied automatically so its score/state stays current.
- **Filters** — Username, Vs Username, Game Mode (resolved from the API's tag-set list).
- **Load** — assign that game's data to the scoreboard.

The pinned-player setting is honored here too; if the pinned player is on the "wrong" side of the API game, sides are swapped on load.

### 4. Rotator

Cycles a scoreboard through a list of games at a configurable interval — typically used to display a continuous "now playing” or “previous matches" feed without hand-loading each game. Games can come from the **completed** API endpoint, the **ongoing** endpoint, or both.

**Populating the rotation (right-side panel when source is "Rotator"):**

1. **Search completed games** (top of the panel):
   - **Username**, **Vs Username**, **Tags** (game modes), **Limit** (games returned).
   - Click **Search** to fetch from `/games`. Each search creates a *search set* — labeled chips you can stack, remove individually, or reuse. New searches add to the pool rather than replacing it.
   - Filters persist across page reloads (`settings.rotation_search.*`) and the rotation is re-fetched automatically when the app restarts.

2. **Pull in live games**: open **Manage → Live Games** tab and click **Refresh Live Games**. Live games can be added to the rotation alongside completed ones.

3. **Auto-poll** (optional): keeps re-fetching the completed-games query on an interval so newly finished games are automatically added to the pool.

4. **Manage modal**: a dual-pane (Available / In Rotation) view per pool with column filters (Username, Stadium, Mode, Date range), sortable headers, and pagination. **Add** / **Remove** moves games between panes; **Load** assigns a single game to the scoreboard immediately without changing rotation membership.

5. **Pool selector** — choose `Both`, `Live Only`, or `Completed` to control which games the rotator advances through.

6. **Interval** — seconds between auto-advances (5–600).

7. **Start** — begins the rotation. Use `< / >` to step manually; the badge shows `current/total · seconds-to-next`.

Rotations resume across app restarts. If a rotation was active when PRSH was closed, it re-fetches the completed-game pool and restarts the same rotation in the background on next launch.

**Per-rotation behavior:** stats for every player in the rotation are pre-fetched in the background as soon as the rotation starts, so transitions don't block on the API. A failure to apply one game logs a warning and moves on rather than killing the rotation.

---

## OBS Setup

Add a **Browser Source** in OBS pointing at one of the layouts served by PRSH.

Overlays subscribe to `v1.state.set` / `v1.state.set_batch` over SocketIO and re-render in real time; no refresh needed after state changes.

> ⚠ When *editing* an overlay HTML file, hard-refresh the browser source (Cmd/Ctrl+Shift+R) to bypass the cache. Safari may also need Option+Cmd+E first.

You can also wire **OBS Text Sources** to individual values — enable export under **Settings → General** and PRSH will mirror each state key into a `.txt` file under `user_data/stream_labels/`.

---

## Tournament Brackets

Two providers are supported, both configured under the **Bracket** tab:

- **Start.gg** — load by tournament slug. Requires the slug only for public events.
- **Challonge** — load by tournament URL. Requires an API key and for the user to be an Admin of the Mario Superstar Baseball Netplay Events Challenge community. Support for Challenge may be deprecated in the future, and Challonge bracket layouts may not be 100% accurate.

Loaded bracket data is exposed both in the in-app Bracket view and via the bracket overlay HTML files above.

---

## Controller Overlay (future) (optional)

PRSH can manage an optional `gc-overlay` subprocess that draws controller inputs as an OBS browser source. Configure under **Settings → Controller Overlay**:
- **Path** — auto-detected as a sibling `../gc-overlay/` directory or inside the frozen bundle; can be set manually.
- **Port** — default 8069.
- **Controller / Auto-start** — which controller to capture and whether to launch on app start.

---

## Multiple Scoreboards

Click **+** in the scoreboard tab strip to add another scoreboard. Each scoreboard:
- Has its own source (one can be HUD while another is on a Rotator).
- Has its own state subtree (`score.{N}.*`).
- Can be renamed via the pencil icon (the alias appears in the tab and can be referenced from layouts).
- Can be removed (close button); at least one scoreboard always remains.

Each layout HTML file accepts a `?scoreboard=N` query parameter to bind to a specific scoreboard.

---

## Settings & Data

- **`user_data/settings.json`** — all user preferences (HUD path, pinned player, rotation config, auto-poll state, etc.).
- **`user_data/state.json`** — persisted scoreboard state. If the app fails to start due to corrupt state: `echo '{}' > user_data/state.json`.
- **`user_data/branding/`** — drop tournament logos here; served at `/branding/`.
- **`user_data/stream_labels/`** — text-file mirror of state (off by default).
- **`user_data/game_assets/msb/`** — user-supplied MSB image pack (character icons, team logos, bat/glove sprites). See [Required: MSB Image Assets](#required-msb-image-assets) above. Add a new team logo by dropping an image into `teamLogos/` named after the MSB team.

---

## Architecture (one-page summary)

```
Project Rio Game ─→ decoded.hud.json ─→ HudWatcher (OS file events)
                                              │
Project Rio API  ───→ OngoingGamePool ───→ RioGameDataProvider ───→ State.SetBatch()
                  └─→ CompletedGamePool ───→ RotationManager ─────┘        │
                                                                            ▼
                                                                  SocketIO + UI + OBS
```

Backend: FastAPI + python-socketio + asyncio + orjson + watchfiles + [pyrio](https://github.com/matt-gree/pyrio).
Frontend: React 19 + Zustand + Mantine 7 + Vite.

For development guidance — module layout, performance rules, and patterns for adding new state keys / API endpoints / overlays — see [CLAUDE.md](CLAUDE.md).

---

## License

See [LICENSE](LICENSE).
