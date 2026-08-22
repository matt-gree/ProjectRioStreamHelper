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
| **Queue / Running order** | One entry in `schedule.queues` — `{id, title, matches}`, an **ordered list** of match ids and only an order: there is no stored position, because several matches run live at once. **There may be several** (a winners order and a losers order), and a board draws from one (`scoreboards.match_queue.{N}`, unassigned = the first). Membership is **exclusive** across orders — a fixture belongs to one, so naming another *moves* it. A board takes the next fixture *waiting for one* (queued, unbound, undecided, never started). Creating a match **enrols** it at the end of an order — the one named by `POST /match?queue={qid}`, or the first when none is; membership and position are authored on the **Match desk**, whose accordion stack *is* these orders and whose per-order **`+`** is how a fixture enters one. Not to be confused with **Rotation**, which cycles one board's game pool. |
| **`schedule.queue`** | A **projection**, not a model: the union of every order in order, rewritten in the same `SetBatch` as `schedule.queues`. It is what the schedule overlay and the console subject read — the union deliberately, so creating a second order never silently drops a fixture off air. Never write it directly. `schedule.title` is the **overlay's heading**, independent of any order's title. |
| **Projector** | The resolve-by-copy pattern: a model (Match, Commentary, PlayerPlates, PostGame, Organizers) resolves its records against the participant registry and copies the result into the state keys overlays read. Deterministic: writes the full key set (value or `""`) so unbinding blanks exactly what it set. |
| **Placement** | A Production rack row: one source, in one scene — `{element}:{board}@{scene}`. The console's row identity; see `src/routes/production/placements.js`. |
| **Element** | A Production-page broadcast unit. **Direct** elements own a dedicated source; **fed** elements have no source of their own and can only be pushed into a container. Being fed is a property of the **placement**, not the element: a member on a container's roster rows under it and pushes into it, while that same element's own source rows on its own and just shows/hides (`placementFlavor`, `src/routes/production/placements.js`). Related: **dedicated source** / **feed** — see `src/routes/production/elements.js`. |
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
| **Size variant** | `?size=` query param, scoreboard layouts only. Which sizes exist and their canvases live in `server/theme_contracts.py` (`CONTRACTS`) — the one source of truth, pinned across runtimes by `tests/unit/test_size_dims_parity.py`. The mount resolves any unknown or retired size to `l`, so legacy OBS sources keep working. |
| **Team variant** | `?team=1\|2` query param. Applies to stats, roster, teamlogo, controller, playername. |
| **Rotation / Rotating** | A board whose playback mode is `rotate`, cycling its pool at an interval. Managed by `PoolManager` (`server/rio/rotation.py`). No other meaning — there is no "player rotation" concept. |
| **Rotator (layout group)** | `public/layout/rotator/*.html` — standalone layouts (e.g. the results ticker) that display rotating content. Distinct from rotate playback. |
| **Design package / Theme** | A swappable SVG theme set under `public/design/{package}/` (default, classic, + user packages in `user_data`). Elements mount theme SVGs via `svg-theme-engine.js` data-slot binding. |
| **HUD game** | Game data sourced from the local `decoded.hud.json` file. |
| **API game** | Game data sourced from `https://api.projectrio.app/`. |
| **Participant / Address Book** | The participant registry (`server/participants.py`, REST-only, `participants.json`): rio name → display identity (name, team, pronouns, socials). The join point for Match, Commentary, PlayerPlates, Matchup and the competition's Organizers. |
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
Post-game stat files ─→ StatFileWatcher ─→ PostGame capture ─────────↗      │
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

**Scoreboard config lives in Settings, not State.** `scoreboards.active`, `scoreboards.aliases`, `scoreboards.binding.{N}` and `scoreboards.match_queue.{N}` are **Settings** keys. Legacy `scoreboards.sources` / flat `scoreboards.rotation` settings are read-only migration fallbacks — never write them.

**A new per-board KEY — state or settings — must be torn down in BOTH `remove_scoreboard` and `POST /scoreboards/reset`.** Board ids are re-used (`_lowest_available_id`), so a leftover isn't dormant, it's inherited by the next board with that id. Read that as per-board **data**, not per-board *setting*: stating it as a settings rule is exactly how `postgame.{N}` — per-board state that doesn't live under `score.{N}`, so `State.Unset("score.{N}")` never reached it — sat outside the teardown while all four settings keys were handled right. The two paths also drifted into opposite halves of the same pair (see below), so **fix both or neither**; `tests/integration/test_scoreboards_api.py` pins the whole set against id re-use.

**`scoreboards.rotation.{N}` is TWO keys in two stores.** In **State** it's the live status mirror (`running` / `game_ids` / `cached_games`, written by `PoolManager`) that the rack badge reads; in **Settings** it's the legacy flat config. Both must go when a board does — and `PoolManager.stop_rotation` clears neither, it drops the task and the binding flag, not the projection. Don't "simplify" either call site to a single store.

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
- **The queue is an order, not a cursor.** `POST /scoreboards/{sb}/next-match` resolves the next waiting fixture and binds it under one lock. Eligible = queued ∧ unbound ∧ undecided ∧ `stage == 'draft'` — stated **once**, in `Schedule.not_waiting_reason`, which returns the producer-facing reason and of which `is_up_next_eligible` is just `... is None`. Never reimplement the four conditions; the verdict and the explanation must not be able to disagree. Several matches run live at once, so **never** add a stored position — see `server/schedule.py`.
- **`stage` is producer-settable, and has to be.** The server only ever moves it forward (`note_live` → `live`, post-game → `post`), so a fixture fed once and then unbound was stranded out of Up next forever by the anti-bounce condition. The Match desk's stage badge is a control (`StageControl` in `desks/match.jsx`) that can send it back to `draft`, and states which condition is holding a fixture back.
- **The match owns the series** (games won within the Bo format); boards own only their live game.
- **Identity gate:** if live players don't match the bound fixture, `score.{N}.match_conflict` raises the app-wide banner; a decided-mismatch auto-retires the binding.
- **Projector rules** (Match, Commentary, PlayerPlates, PostGame, Organizers all follow this shape — reuse it, don't invent a new one): resolve records against the Participants registry, write the *full* owned key set via `SetBatch` (value or `""`), wrap `project_all()` startup hooks in try/except so a bad record never blocks boot (use `run_startup_projection`).
- **A FEED-SHARED key is written with a value, never blanked over live data.** `score.{N}.player.{T}.*` is the one place a projector and a live feed both write, and for the Match projector the overlap is *total* — every key it owns is also fed (`_FEED_SHARED_KEYS`, `server/match.py`). Full-key-set determinism still applies to a board with no game; over a board carrying one, an empty projected value defers. This began as a two-key captain carve-out, and the two keys it left out were the ones that name the player: unbinding mid-game blanked both sides' `rioName` while the board kept its teams, rosters and inning, so the Quick Rail said "No game on this board yet" for a board at inning 9. Deferring on *every* empty value is the mirror-image bug, so the rule turns on whether a blank is an **answer**: an address-book field is one once a participant resolves (re-binding to someone with no twitter must clear it), while `port`/`rio_captainIndex`/`character.0.name` never are (`_OPTIONAL_PICK_KEYS`). The discriminator for "is there live data here" is `score.{N}.game_id` — a projection's own output populates the side, so asking "is the side populated" strands the fixture an unbind is supposed to clear.
- **A new projector must be added to `Participants.reproject_dependents()` in the same change.** Resolve-by-copy means the copy goes stale when the *book* changes, and a projector re-projects on its own config change and at boot — not when the registry it resolves against is edited. That fan-out is the one statement of "who read the book"; every Address Book write (`Create`/`Update`/`Delete`, and **once** per batch for the two imports) calls it. Miss it and a producer's mid-broadcast name fix reaches the Address Book and nothing else until relaunch. **`Matchup` is the exception that proves the shape**: it is a *fetched* artifact with no cheap re-projection, so only its per-side tag re-resolves (`Matchup.refresh_tags`) — never re-run a network fetch from the fan-out.

> Deep dive: `.claude/skills/match-binding-lifecycle/SKILL.md` — binding schema, fixture shape, the full cascade table, identity gate, game-end detection, start.gg.

---

## Production Tab & Elements

The Production tab is a **console with three surfaces** — rack (monitor + select), stage (work on the one selected thing), quick rail (producer-pinned cards). Every element declares the same contract (registration · quick face · stage body) and all three surfaces compose from the shared row kit. **Read `.claude/skills/production-console-contract/SKILL.md` before touching `src/routes/production/`** — it is a router (surfaces · cross-cutting invariants · checklist) that names the one file under `reference/` to load for the area you're in.

- **OBS scenes are the rack's grouping axis**, and rows are **placements** (`src/routes/production/placements.js`): one row per source per scene, keyed `{element}:{board}@{scene}`. The rack lists only what is really in a scene — derivation runs source → row — and the **+** in each scene header (`addsource.jsx`) is how a source is created. There is no "phase" concept; it was removed in favour of the producer's own scene list.

- **A member that owns a source is TWO rows, and Push belongs to the slot.** The post-game callouts each have their own layout (`public/layout/postgame/{spotlight,summary}.html`) *and* sit on the Callout Stage's roster — the same shape as the hit visualizer. Their own row gets Bind/Air and no Push; their row **under** a container gets the Push. `element.flavor` is only "does it own a source"; every surface branches on `isFedPlacement(placement)`. A bespoke push button on a direct panel is the thing the source strip exists to end (the hit visualizer's "Split feed" is gone for that reason).

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
- **A `set_batch` frame has TWO lists: `items` and `augmented`.** `items` is what the caller wrote; `augmented` is what a write-path hook (`State._augment` — today the container automation engine) decided *off* that write, riding the same frame so a consequence never lands a frame after its trigger. The split exists because a client suppresses the echo of its **own** frame by `sid`, and a hook's entries are not its write — they are the server's answer to it. Mixed into `items` they were dropped by the one client that needed them most: a producer's Push got `production.feed.reason.{container} = manual` back and never saw it, so their console kept reporting the container as *resting* — rules still running — while every other browser had it right. **Every consumer must read both lists** (`src/context/socket.jsx`, `public/layout/lib/overlay-base.js`).
- `v1.settings.set` — settings updates (bidirectional).
- `v1.state.get` — client requests full state on connect.
- `v1.action` — ephemeral action cues (see action bus).

---

## Tournament Integration (start.gg)

Start.gg GraphQL via `StartGGProvider`, loaded by event URL/slug on the Competition tab. **Match-first:** a set loads into a `match.{M}` and the producer binds that match to a board. Both the API route and the bracket view's "Load to Match" go through `apply_startgg_set`. Unseeded phases produce string preview ids (`preview_…`) — set ids are `int | str`.

There is **no direct set→score path**. (Challonge was fully removed in July 2026; don't reintroduce provider branching.)

**Every start.gg write into `tournamentInfo` goes through `auto_fill_entries`** (`server/startgg/provider.py`), which is the one statement of the auto-fill rule: overwrite a field only while it is still empty or still equal to what we last filled it with (recorded per field in `tournamentInfo._auto`), so a producer's hand edit survives a reload and re-blanking hands the field back. Two callers, and the second is why it is a function — `_load_event` fills five fields once per *event*, while `apply_startgg_set` fills `phase` once per *set* and used to write unconditionally, destroying a typed Competition Phase on every fixture load. `skip_blank=True` is the per-set difference: a set that reports no phase is saying nothing, where an event with no address is saying it has none.

**The Competition tab holds facts about the event; a value only ONE overlay reads is that element's own setting.** The Event Header's banner line was `tournamentInfo.message` and is now the message field's own text on that element's bands, authored on its Production stage panel. Ask which surfaces read a value before deciding where it is authored.

**The Competition tab is ONE page about one loaded event** (`src/routes/competition/competition.jsx`): the loader, the competition form in a fixed 40rem left column (`tournament_info/tournament_info.jsx` — the form and nothing else), and a right column holding whichever *list* the producer wants — **Entrants** (`competition/entrants.jsx`, setup-time: map the field into the Address Book) or **Sets** (`bracket/bracket.jsx`, run-time: browse the bracket and Load to Match). It used to be two pages behind a segmented control, which asked a producer to choose between the event's facts and the event's sets and bundled the form in with the entrants table — so the form's own width was a function of whether a tournament had been loaded. **The switch chooses a list, never a page**; the form stays on screen for both. Keep the two lists mounted (switching must not refetch), and say "nothing loaded" once, on the page, not once per list.

**The entrants list carries only what a producer acts on** — seed, tag, Address Book state, Rio ID — plus a census of what is still unmapped. A start.gg profile's full name, pronouns, country and state are the **Address Book's** fields; the import copies them there (`sg_to_display`, `server/participants.py`) whether or not this page draws them, so a column here is a read-only duplicate crowding out the two fields the page exists to change. **A sponsor prefix is never displayed anywhere** — not on an entrant, not on a set — which is why `entrant_name` in `server/startgg/parsers.py` answers with the participant's bare `gamerTag` rather than start.gg's `"AAA | Alice"` entrant name (the cached-bracket path always did, so the two disagreed); it falls back to the entrant name for a team or a preview set, where there is no single tag.

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

### Git: submodules and `gh`

- **Push a submodule BEFORE the PRSH commit that pins it.** A pin is a bare SHA, resolvable on the machine that made it and nowhere else until the submodule is pushed — so pushing PRSH first publishes a pointer only that machine can follow, and CI dies in `git submodule update` with `upload-pack: not our ref`, naming neither the submodule nor the cause. `scripts/check-submodule-pins.py` runs from `.githooks/pre-push` and blocks exactly this (enable once per clone: `git config core.hooksPath .githooks`; override with `git push --no-verify`).
- **PRSH is a GitHub fork of TournamentStreamHelper, and `gh` resolves a fork to its parent.** Left unset, `gh run list` returns *nothing* and `gh run rerun` 404s against the upstream repo — quietly, as an empty result rather than an error. Fixed here via `gh repo set-default matt-gree/ProjectRioStreamHelper` (`remote.origin.gh-resolved`); a fresh clone needs it again. The `upstream` remote was removed — we never pull from TSH, and it carried a live push URL to a repo we don't own.

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
| Match lifecycle / series / start.gg sets | `server/match.py`, `server/api/v1/match.py` (`bind_board` owns board↔match), `server/rio/game_end.py` |
| Fixture authoring UI (sides, format, series, flip/decide/reopen, board bind) | `src/routes/production/desks/match.jsx` — the only place. The Match tab is **deleted** (`MatchPanel`, `ScoreControls`, `PoolBrowser`, `src/routes/scoreboard_manager/`); `/scoreboard` renders the console for old bookmarks |
| Match queues (membership, order, "up next" per board) | `server/schedule.py` (`queues`, `append`/`move`/`remove`, `next_up(qid)`, `next_up_for_board`, `queue_for_board`, `ensure_migrated`, `reproject`, and `not_waiting_reason` — the one statement of eligibility; **`_commit` owns all change detection**, so no verb early-outs past the projection), `server/api/v1/schedule.py` (queue CRUD + per-id verbs; `move` takes no queue id on purpose), `take_next_match` in `server/api/v1/match.py` (board's order + `?queue=` override); client `src/context/schedule.js` + `src/routes/production/queue.js` (`useQueues`, `useBoardQueueId`, `useNextUp(sb)`, `useNextInOrder(qid)`, `useWaitingReason`), authored on `desks/match.jsx` (`QueueHeading`, `MembershipControl`, `NewQueueButton`), assigned on `desks/board.jsx` (`BoardQueueRow`), taken on `desks/board.jsx` + `quickface.jsx`. The Upcoming Schedule stage panel (`stage/schedule.jsx`) is display-only — heading + per-match time |
| Deleting matches outside `delete_match` | **Call `Schedule.reproject()`.** `queues()` prunes dead ids on *read* only, so a path that unsets `match.{M}` directly (`POST /scoreboards/reset`) leaves the stored `schedule.queues`/`schedule.queue` listing fixtures that no longer exist — and the console subject row counts the projection. `ensure_migrated` re-projects at boot for the same reason |
| Match lifecycle (`stage`, and why a fixture isn't up next) | `StageControl` in `src/routes/production/desks/match.jsx` (momentary `PUT /match/{m}`), `Schedule.not_waiting_reason` + `useWaitingReason`, `tests/unit/api/test_schedule_waiting.py`. Server writers only move forward: `Match.note_live`, `server/postgame.py`, `server/rio/provider.py` |
| A board's games (pool, playback, rotation transport, game search) | `src/routes/production/games.jsx` (`GamesSection` = the mode + its surface; the one dialog is the rotating pool's member list), rendered by `desks/board.jsx` as its own `Games` region; server side `server/bindings.py`, `server/rio/rotation.py`, `server/api/v1/rotation.py` |
| Game-mode vocabulary (pickers, the pool's mode filter) | `src/routes/production/gamemodes.js` (`useGameModes` = active + ended tiers, `withHeldModes` = plus whatever a surface already holds) — the one source for every mode picker; server side `GET /rio/game-modes[?scope=all]` (`server/api/v1/stats.py`) over `stats_api.fetch_game_modes` (active, in-memory) / `fetch_all_game_modes` (the ~200-mode catalogue, pyrio's disk cache). **The active list is not the vocabulary**: a board's mode comes from the game it carries, so anything that must *say* or *match* a mode takes the catalogue |
| Add/modify state keys | `server/state.py`, `src/context/store.jsx` |
| Add API endpoints | `server/api/v1/` (decorate with `@method`), register in `server/api/__init__.py` |
| Settings schema | `server/settings.py` (defaults + migrations), `src/components/SettingsModal.jsx` |
| Add/modify a Layout or element overlay | `public/layout/<group>/` + `public/layout/lib/*-mount.js`, register in `src/routes/layouts/designConstants.js` (+ `src/routes/production/elements.js` if a Production element) |
| Sample data / demo mode | `public/layout/preview/*_sample.json`, `public/layout/lib/overlay-base.js` (`sample` option), `src/routes/production/sample.jsx` (switch + banner) |
| Theme/design packages | `public/design/`, `server/design_packages.py`, `public/layout/lib/svg-theme-engine.js` |
| Controller-port colours (the side tint five overlays share) | `public/layout/lib/port-colors.js` (overlay runtime) + `src/routes/layouts/designPackage.js` (`resolvePortColors`/`usePortColors`, app runtime) — **one palette, resolved the same way in both**: the producer's `overlays.global.port{N}Color` (Design tab → Controller Ports, `design.jsx`) → the active package's manifest `portColors` (`_port_colors` in `server/design_packages.py`) → `DEFAULT_PORT_COLORS`. Never a per-element copy: it was one, on the Character Spotlight, and recolouring port 1 there left the other four overlays red |
| Production console (rack/stage/rail) | `src/routes/production/{rack,rail}.jsx`, `stage/`, `desks/`, `kit/`, `elements.js`, `placements.js` (row identity), `addsource.jsx` (Add picker) |
| One board's console panel (mirrored game state, lineup readout, `side_reason`, corrections, rename) | `src/routes/production/desks/board.jsx` (`SidePanel`/`RosterGrid`/`useSideTeam`) + `boards.js` (`boardDeskId`, `useActiveBoards`), rows in `rack.jsx` (`useRigRows`, `RigSection`, `RowRemove` — add/remove a board), bodies in `production.jsx` (`deskBodiesFor`), face in `quickface.jsx` (`deskQuickFace`) |
| Shared containers (definitions, roster) | `src/routes/production/containers.js`, `stage/container.jsx`, `public/layout/shared/container.html`, `production.container_defs` in `server/settings.py`, `server/api/v1/layouts.py`. **A member's board and side come from the container it is nested under** — one hook, `useMemberScope(element, placement.slot)`, read by the rack radio, the source strip, the rail faces and the stage pickers; a lookup by element answers with the first roster, which on the shipped mirrored pair is a coin flip. A `containerScoped` member has no standing intent, so its remembered payload is never replayed over that scope (`feeds.js`, `feeds.test.jsx`) |
| Container runtime (members, cross-fade, centering) | `public/layout/lib/fed-container.js` (the `MEMBERS` registry — add a member here, never control flow) + `lib/container-layers.js` (retained layers, cross-fade, `memberBox`, `resolveFeed`). **Scope is applied by the WRITER, never here**: the payload on the feed key is already scoped (`_scope_of` server-side, `useMemberScope` for a Push), so the runtime draws what it is given — a second place to apply scope can only disagree with the first |
| Container automations (rules, dwell, resting, reason) | `server/automations.py` (engine + `RESOLVERS`, registered on `State.hooks`), `server/state.py` (`_augment`), `src/routes/production/automations.js` (quick-add library), `stage/automation.jsx`, `tests/unit/test_automations.py` |
| Console with no OBS (catalog tier) | `src/routes/production/placements.js` (`catalogPlacements`, `useConsoleOffline`), `rack.jsx` (`CatalogSection`), `sourcestrip.jsx` (Copy URL), `addsource.jsx` (`open` vs `scene`) |
| Production OBS control / staging | `src/context/obs.jsx`, `src/context/staging.js` |
| Participant registry | `server/participants.py`, `src/routes/player_list/` |
| Competition organizers (address-book references, not free text) | `server/organizers.py` (the projector — **an absent `tournamentInfo.organizers` means never authored and is left alone**, or it would erase legacy hand-typed text), `server/api/v1/organizers.py`, `src/context/organizers.js`, `OrganizerRows` in `src/routes/tournament_info/tournament_info.jsx` (that file is now the competition FORM only — the entrants table moved to `src/routes/competition/entrants.jsx`) |
| Event Header bands (order, visibility, per-field text) | **A band is an ordered LIST, not a run of switches**: `overlays.eventheader.bands.{header,footer}` = `[{id, on, text}]`, drawn left→right, `text` overriding the field's source and blank falling back to it (which is why `message` is just the entry with no source). Model + census in `src/routes/production/eventheader.js` (client) and `EVENTHEADER_FIELDS` / `_eventheader_bands` in `server/settings.py` (migration off the old `show*` switches, and the heal that keeps a field from ending up in no band); drawn by `public/layout/eventheader/eventheader.html` (`fieldSource`); authored as two ribbons on `src/routes/production/stage/eventheader.jsx`. Both bands share ONE settings key so a cross-band move can't be half-confirmed. `LAYOUT_SETTINGS.eventheader` keeps only what is genuinely a setting — each band's own on/off, its offset, and the shared look |
| Post-game callouts (Character Spotlight, Game Summary) | `public/layout/postgame/{spotlight,summary}.html` (their own sources — the spotlight draws the standing pick, `production.feed.last.postgamecallout`) + `public/layout/lib/postgame-{callout,vs}-mount.js` (shared with the container path via `fed-container.js`'s `MEMBERS`); registered `direct` + `containerHostable` in `src/routes/production/elements.js` |
| Post-game capture | `server/postgame.py` (+ StatFiles path gating), `server/postgame_watch.py` (**auto-capture**: Project Rio writing the stat file IS the end-of-game signal for a local board — the HUD feed has no final frame — gated by `postgame.auto_capture`, default on); console surface is a **region on the board panel** (`src/routes/production/postgame.jsx` → `desks/board.jsx`), never a desk |
| Game Summary captain hero art (size/placement/mirror) | `public/layout/lib/captain-framing.js` (measured art + per-side frames) + `src/routes/layouts/captain-framing.test.js` (pins the no-clip / face-clear / one-size contract) |
| Tournament integration | `server/startgg/`, `server/api/v1/startgg.py` |
| Which bracket phase is on air | `src/routes/production/bracket.jsx` (the shared `useBracketDesk` + `BracketPhasePicker`), surfaced on the **source that draws it** (`stage/bracket.jsx`) and the lower-third's bracket slot. One loaded phase app-wide (`bracket.*`); there is no Bracket desk — both consumers already carried the picker |
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
