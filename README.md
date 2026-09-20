# ProjectRioStreamHelper (PRSH)

<img width="1512" height="863" alt="image" src="https://github.com/user-attachments/assets/4f8b69a6-1a75-4663-90fa-3fc63086baa0" />


A web-based tournament stream overlay manager for **Mario Superstar Baseball (MSB)** played through the [Project Rio](https://www.projectrio.online/) emulator. PRSH runs locally on the streamer's machine, exposes a web UI for managing scoreboards, and serves OBS browser-source overlays that update in real time.

PRSH is forked from [TournamentStreamHelper](https://github.com/TournamentStreamHelper/TournamentStreamHelper) and rebuilt as a single-game web app on FastAPI + React.

---

## Quick Start

### Install (end users)

Pre-built installers are produced from `PRSH.spec` (PyInstaller) and `installer/PRSH.iss` (Inno Setup, Windows):

- **macOS** — `PRSH-macOS-arm64.zip` or `PRSH-macOS-x86_64.zip` from the [latest release](https://github.com/matt-gree/PRSH/releases/latest); unzip and drag `PRSH.app` to Applications.
- **Windows** — `PRSH-Setup.exe` from the [latest release](https://github.com/matt-gree/PRSH/releases/latest); run the installer.

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

**Where to get it.** The community image pack lives in the [Mario Superstar Baseball Discord](https://discord.gg/WfkYyaHBEu).

**The fast way in.** Download the pack, unzip it, then **Connections → MSB image pack → Import…** and select the unzipped folder. PRSH finds the pack inside whatever you pick (a wrapper folder from the zip is fine) and **copies** the images into its own folder, so nothing breaks later when you tidy up your Downloads. The card's census re-checks itself the moment the copy lands.

**Where it puts them.** PRSH's own assets folder, under your user data directory:

- **macOS** — `~/Library/Application Support/PRSH/user_data/game_assets/msb/`
- **Windows** — `%LOCALAPPDATA%\PRSH\user_data\game_assets\msb\`
- **Run from source** — `./user_data/game_assets/msb/`

The folder is created automatically on first launch. Import fills it for you; to populate it by hand, drop your asset pack inside so the layout looks like:

```
.../user_data/game_assets/msb/
├── characterIcons/    *.png — one per character (54)
├── teamLogos/         *.png — one per in-game team name (48)
└── gameIcons/         bat.png, glove.png, superstar.png
```

The **Connections** tab's MSB image pack card validates the folder against the canonical filename lists from [pyrio](https://github.com/matt-gree/pyrio) and shows exactly what's missing per category.

**Open Folder** on the same card reveals it in Finder/Explorer, for dropping files in by hand — tab back to PRSH and the census re-checks itself. The Welcome screen also shows whether assets were found on first launch.

**Custom location.** If you keep a shared asset pack for use across multiple tools, point PRSH at it via **Connections → MSB image pack → Browse…** and select your folder — that stores a *pointer* rather than copying, and the override persists in `settings.json`. Importing clears it again, since the pack PRSH just copied in is the one it should read.

---

## How It Works

The console shows one or more **scoreboards** (boards). Each board is an independent set of state keys (teams, players, score, inning, runners, etc.) and has its own desk on the **Production** tab. The same state drives the console and every OBS browser-source overlay in `public/layout/`.

State changes flow through a single store (`server/state.py`) that broadcasts diffs over SocketIO and optionally (toggle in settings) exports each value as a text file under `user_data/stream_labels/` for use as OBS Text Sources.

---

## Where a Board's Game Comes From

There is no source picker. **Board 1 follows the local HUD file** while **Connections → Project Rio → Follow local HUD** is on; every other board (and board 1 with that switch off) takes its games from the Project Rio API. The board desk shows which with a `HUD` / `API` badge on its game-state header.

A board with no game on it is simply empty: you can bind a match to it, and the score, count and runners can be set by hand from the board desk.

### Local HUD (board 1)

PRSH watches Project Rio's `decoded.hud.json` file and pushes every change into the board in real time — score, inning, half-inning, batter/pitcher, balls/strikes/outs, runners on base, character stats. This is the right setup when *you* are running the Project Rio client locally.

**HUD file default paths (auto-detected):**
- macOS: `~/Library/Application Support/Project Rio/HudFiles/decoded.hud.json`
- Windows: `%APPDATA%\Project Rio\HudFiles\decoded.hud.json`
- Override for custom path on the **Connections** tab

The watcher uses OS-level file events (kqueue / inotify / ReadDirectoryChanges via `watchfiles`), so there's no polling cost between game updates. **Re-read HUD** on the board desk reloads the file by hand.

**Side preservation.** Project Rio randomly assigns away/home each game. PRSH decides which player sits on side 1 and side 2 on every board, in this order:
1. **Swap sides** on the board desk — outranks everything for the rest of the current game. **Use auto** hands the sides back.
2. **The bound match** — a match's side 1 participant is seated on side 1.
3. **Pinned player** (Address Book → **Side**) — give someone a preferred side and PRSH seats
   them there. Any number of people can have one; if two players in the same game want the *same*
   side, the pin steps aside and the next layer decides.
4. **Back-to-back detection** — if a returning player switched sides, auto-swap.

The desk shows which layer decided with a badge beside **Swap sides**. While a game is feeding the board, the fields the feed writes (score, count, runners) stop taking input — a hand edit would be overwritten by the next frame. Address Book fields (name, pronouns, socials) still resolve from the Address Book.

### Project Rio API (every other board)

For **remote** matches you're casting. The board desk's **Games** region picks how the board plays:

**One game** — pick a single game and keep it on the board.
- **Live** tab: the games being played right now. The list loads when you open it; **Refresh** re-fetches it.
- **Completed** tab: search finished games by game mode, player, opponent, date range and **Limit** (Rio returns at most 50), then **Find games**.
- **Put on board** puts that game on the board. A live game stays current on its own — PRSH keeps polling it while it is on a board.

**Rotating** — cycle the board through a pool of games.
- **Scope**: `Live + Completed`, `Live Only` or `Completed Only`.
- **Filter**: game modes, player, opponent, and (for completed games) date range and limit. **Find games** fills the pool from the filter.
- **Seconds per game** — how long each game stays up (5–600 s).
- **Keep pool current** — re-checks the filter on an interval (10–600 s, default 60) so newly started and newly finished games join the pool and ones that no longer match leave it. Off = the pool only changes when you press **Find games**.
- **Pool games** opens the pool's member list, where you can exclude a game (and put it back).
- **Start rotating** / **Stop**, with previous / next to step by hand.

A rotation that was running when PRSH closed resumes on the next launch. A game that fails to apply logs a warning and the rotation moves on.

The pinned-player rule applies to API games too: if a pinned player is on the "wrong" side of a game, the sides are swapped when it is applied.

---

## OBS Setup

Add a **Browser Source** in OBS pointing at one of the layouts served by PRSH.

Overlays subscribe to `v1.state.set` / `v1.state.set_batch` over SocketIO and re-render in real time; no refresh needed after state changes.

> ⚠ When *editing* an overlay HTML file, hard-refresh the browser source (Cmd/Ctrl+Shift+R) to bypass the cache. Safari may also need Option+Cmd+E first.

You can also wire **OBS Text Sources** to individual values — enable **Write text files for OBS** under **Settings → Output** and PRSH will mirror each state key into a `.txt` file under `user_data/stream_labels/`.

---

## Tournament Brackets

Two providers are supported, both configured under the **Bracket** tab:

- **Start.gg** — load by tournament slug. Requires the slug only for public events.
- **Challonge** — load by tournament URL. Requires an API key and for the user to be an Admin of the Mario Superstar Baseball Netplay Events Challenge community. Support for Challenge may be deprecated in the future, and Challonge bracket layouts may not be 100% accurate.

Loaded bracket data is exposed both in the in-app Bracket view and via the bracket overlay HTML files above.

---

## Controller Overlay (optional)

PRSH can manage an optional `gc-overlay` subprocess that draws controller inputs as an OBS browser source. It ships with PRSH (and is found as the `gc-overlay/` submodule in a source checkout), so there is nothing to locate. Configure under **Connections → Controller reader**:
- **Port** — default 8069.
- **Controller / Auto-start** — which controller to capture and whether to launch on app start.

---

## Multiple Scoreboards

Add a board from the **+** in the Production rack's **BOARDS** section. Each board:
- Takes its games independently (board 1 can follow the HUD while board 2 rotates API games).
- Has its own state subtree (`score.{N}.*`).
- Can be renamed by clicking the title of its desk.
- Can be removed from its rack row; at least one board always remains.

Each layout HTML file accepts a `?scoreboard=N` query parameter to bind to a specific board (a missing parameter means board 1).

---

## Settings & Data

- **`user_data/settings.json`** — all user preferences (HUD path, each board's games and rotation, design settings, etc.).
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
