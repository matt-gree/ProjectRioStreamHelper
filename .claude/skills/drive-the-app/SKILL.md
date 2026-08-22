---
name: drive-the-app
description: How an agent actually operates PRSH as a producer would — the scripts/prsh-agent.py CLI (boot, scenario, state-by-prefix, HUD field poking, doctor), the browser-driving recipe and the in-app browser pane's limits, a UI map of where every workflow is authored, and the false positives an isolated instance manufactures. Read before opening PRSH in a browser, exercising a producer workflow end to end, or reporting a UI bug found by driving the app.
---

# Drive the App

`run-and-verify` covers *running* PRSH (suites, boot overrides, replay harness).
This skill covers *using* it: getting to an interesting state cheaply, reading
what happened, and knowing which surprises are the app's fault and which are the
harness's.

**Most questions about PRSH's behaviour are state questions, not pixel
questions.** A screenshot costs ~1.5k tokens and has to be interpreted; the same
answer is usually one line of `prsh-agent.py state`. Reach for the browser when
the thing under test is *rendering, layout or a click path* — otherwise drive the
API and read state.

## The CLI

`scripts/prsh-agent.py` wraps the whole isolated-instance lifecycle. Everything
lands under `/tmp/prsh-agent` (own user_data, port 5299, own HUD file), so it
never touches the developer's real `user_data/`.

```bash
./venv/bin/python scripts/prsh-agent.py up --fresh        # boot, wait for ready (~2s)
./venv/bin/python scripts/prsh-agent.py scenario live-match
./venv/bin/python scripts/prsh-agent.py doctor
./venv/bin/python scripts/prsh-agent.py state score.1 production.feed
./venv/bin/python scripts/prsh-agent.py hud --set 'Batter Roster Loc=3'
./venv/bin/python scripts/prsh-agent.py down
```

- **`doctor` first, always.** It prints boards (names, teams, score, inning),
  each board's `match` / `side_reason` / `match_conflict`, every match with its
  stage and series, the running orders, and what each container is carrying with
  its `production.feed.reason`. It is the one screen where two surfaces
  disagreeing shows up as two lines rather than as a screenshot to interpret.
- **It ends with the cross-subsystem invariants** (`server/invariants.py`, served
  by `GET /api/v1/invariants` — the same list `tests/integration/test_invariants.py`
  runs). `doctor --assert` exits 1 on any violation, so it drops straight into a
  smoke script. These cover exactly the bugs that hide from unit tests: a
  projector blanking a key the feed owns, a `side_reason` naming a layer that is
  gone, a container feeding something off its own roster, a drifted
  `schedule.queue`. **Run it after every workflow you exercise** — that is
  cheaper and more reliable than reading a screenshot for the same defect.
- **`state <prefix>` is one HTTP call** however many keys you want. The REST
  route's `?key=` fetches a *single* key, so reading a board key-by-key is a
  request per key; `state` pulls the tree once and filters locally. Add
  `--settings` for the Settings store — remember the split (`scoreboards.active`,
  `scoreboards.binding.{N}` are **Settings**; `score.{N}.*` is **State**).
- **`hud --set` is the difference from `replay-hud.py`.** The captured frames are
  whole games; most behaviour worth poking is one field moving on the frame
  that's already live — a batter change firing a container automation, a score
  edging up. `replay-hud.py` still owns the canned frames and the sequences.
- **`scenario live-match`** gets you participants + a Bo3 fixture bound to board
  1 + a live game at inning 9, in one command. Doing that by hand is ~20 calls.

## Driving the browser

Open the app at `http://localhost:5299/#/`.

- **It is a `HashRouter`.** Routes are `#/`, `#/competition`, `#/player_list`,
  `#/layouts`. Navigating to `/production` hits FastAPI and returns
  `{"detail":"Not Found"}` — that is your URL being wrong, not a missing SPA
  fallback. Don't file it.
- **Prefer `read_page` refs over screenshot coordinates.** `read_page
  filter:interactive` gives every control an accessible name and a `ref_N`
  (`"Flip sides on match 1"`, `"Match 1 lifecycle: draft"`), and clicking by ref
  is stable across re-renders. Coordinate clicking needs a fresh screenshot after
  every DOM change and silently lands on the wrong element when it doesn't.
- **Screenshots are scaled.** The pane reports 800×450 for a 1280×720 viewport —
  screenshot coordinates are what `computer` wants, but anything you feed to
  `javascript_tool` (`elementFromPoint`) needs ×1.6.
- **Native `<select>` menus don't open in a screenshot.** Use `form_input` with
  the ref (format Bo1→Bo3, game mode, the container member picker).
- **Measure toasts and animating elements twice.** A first measurement can catch
  a mount transition mid-flight and report nonsense (a toast measured 34×769 one
  frame after mount, 356×76 once settled).
- **`document.visibilityState` is permanently `"hidden"` in the pane.** Anything
  gated on the page being visible behaves differently here — most visibly,
  sonner pauses its auto-dismiss timers, so **every toast sticks around forever**
  and they pile up over the top-right of whatever page you're on. A toast that
  won't go away is this, not a missing `duration`. Check
  `document.hasFocus()` / `visibilityState` before believing a timing bug.

### The pane does not render iframes

`contentDocument` is `null` for every `<iframe>` and nothing paints, with no
`sandbox` attribute and same-origin URLs. This hits **the Design tab's five live
previews** and **the Production stage's preview strip** — they come up as empty
boxes in the pane while being perfectly fine in a real browser.

**Do not report blank previews as an app bug from this pane.** Verify a preview
by loading its URL as a top-level page instead — the src is right there in the
DOM, e.g.

```bash
/layout/scoreboard1/scoreboard.html?scoreboard=1&size=l&preview=1&sample=1&preview_globals_only=1
```

Layout URLs (with their `?size=`/`?team=` variants) come from
`GET /api/v1/layouts`; guessing paths wastes calls — the scoreboard lives under
`/layout/scoreboard1/`, not `/layout/scoreboard/`.

## UI map — where each workflow is authored

| Want to… | Go to |
|---|---|
| Everything about the broadcast | **Production** (`#/`) — rack (left, monitor+select) · stage (centre, the one selected thing) · quick rail (right, pinned faces) |
| Author a fixture: participants, captains, ports, round/phase, format, series, flip, bind to a board, running order | Rack → **DESK → Match**. The only place; there is no Match tab |
| One board's live game: score, inning, lineups, `side_reason`, swap sides, rename, game mode, post-game capture | Rack → **BOARDS → Scoreboard N** |
| Add/remove a board | The **+** in the BOARDS header / the trash on the row |
| Create an OBS source, or copy an overlay URL with no OBS | The **+** in a scene header (with OBS) or the catalog tier's Add picker (without) |
| Build a container, edit its roster, set its resting occupant, add an automation rule | Select the container → its stage panel |
| Event facts, entrants, bracket sets | **Competition** (`#/competition`) — one page: loader + form (left) and Entrants *or* Sets (right) |
| Participant registry | **Address Book** (`#/player_list`) |
| Theme package, port colours, global look | **Design** (`#/layouts`) |

Two navigation facts that cost calls if you don't know them: the participant
picker on the Match desk only offers `Add "<name>" to address book` **after you
type a name** (an empty book shows "No saved people yet" with no create
affordance), and the stage's default selection on a fresh profile is whatever was
last selected — browser-local, so a `--fresh` server does not mean a fresh
console layout.

## False positives an isolated instance manufactures

Check these before reporting anything found this way.

- **`PRSH_HUD_FILE` is authoritative and skips the existence check**, so
  `GET /rio/hud-path` returns a `resolved` path even when no file is there and
  the Welcome card's "Project Rio HUD file — Found" ticks green. For a real user
  `get_user_hud_path()` returns `None` when nothing exists and the row is
  correctly unticked. Not a bug.
- **No Rio API key** (`PYRIO_KEY`) in a bare checkout: the boot log says so, the
  tag-set resolve on a new game fails, and `score.{N}.game_mode` stays `""`.
  Expected here; don't chase it.
- **No OBS.** `ws://127.0.0.1:4455` connection errors fill the console and the
  rack shows its **catalog tier** instead of scene sections. That is the
  supported offline mode, not a degraded one — see `prsh-console-without-obs`.
- **The HUD replay has no final frame.** Series crediting on a local board comes
  from the *stat file* (`postgame_watch.py` → `Match.award_game`), not from HUD
  data, so replaying `game1_mid → game2_start` leaves `series` at 0–0. Correct
  behaviour, not a missed credit.
- **Boot logs an `ERROR` for the HUD file** before the first frame is written
  (`No such file or directory`). Cosmetic in this harness.

## Smoke checklist for a producer-workflow change

1. `prsh-agent.py up --fresh` then `scenario live-match`, then `doctor` — the
   baseline should show one board, `side_reason='match'`, no conflict.
2. Exercise the change. Prefer `hud --set` over a whole frame when you want one
   input to move.
3. `doctor` again and diff it by eye. **A projector write is the usual
   suspect**: fixture keys and live-feed keys meet at `score.{N}.*`, and a
   projection that blanks a key the feed also owns leaves the board internally
   inconsistent until the next feed frame heals it — invisible in a busy game,
   permanent when frames stop.
4. Only then open the browser, and only for what actually needs pixels.
5. `prsh-agent.py down`. The instance dir is disposable.
