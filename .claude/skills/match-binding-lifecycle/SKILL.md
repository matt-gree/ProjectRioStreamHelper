---
name: match-binding-lifecycle
description: PRSH match fixture model, scoreboard bindings (pool + playback + derived transport), the player-side cascade (manual > match > pin > back_to_back), the per-game identity gate, series crediting / game-end detection, and start.gg set loading. Read before touching server/match.py, server/bindings.py, server/rio/provider.py orientation code, game_end.py, or any board-binding UI.
---

# Match & Binding Lifecycle

## Bindings: what fills a board (`server/bindings.py`)

`scoreboards.binding.{N}` is a **Settings** key (not State):

```
{ "pool":     { filters: [{id, tag, username, vs_username, limit_games}, ...],
                scope: "live"|"completed"|"both",
                pinned: [gameId,...], excluded: [gameId,...],
                refresh_interval: sec (0 = static/pinned-only) },
  "playback": { mode: "single"|"rotate",
                gameId: null = auto-follow (single),
                interval: sec, running: bool (rotate), current_index },
  "stats_tag": str|null }
```

- **"Manual" is not a source type** — it's the empty binding (single playback,
  empty pool). There is no source enum anywhere; don't reintroduce one.
- **Transport is derived, never user-picked**: `bindings.transport(sb)` returns
  `"hud"` iff `sb == 1` and the global `project_rio.hud_enabled` Settings
  toggle is on; every other board is `"api"`. `hud_target_scoreboards()`
  returns `[1]` or `[]`.
- `get_binding(sb)` merges `pool`/`playback` one level deep against defaults —
  partial writes from endpoints don't lose sibling keys. Always read through
  it, never `Settings.Get("scoreboards.binding.N")` raw.
- `is_rotating(sb)` gates "can this board be assigned a game / bound to a
  match". Rotate `running` is distinct from `mode`: Stop pauses cycling but
  stays in rotate mode; resume-on-startup restarts only boards `running` at
  shutdown. `PoolManager` (`server/rio/rotation.py`) owns membership refresh +
  cycling and mirrors live status into State `scoreboards.rotation.{N}.*`
  (read-only for everyone else).
- Legacy `scoreboards.sources` / flat `scoreboards.rotation` Settings are
  read-only migration fallbacks — never write them.
- `POST /scoreboards/reset` is the escape hatch for stale board/binding state.

## The Match fixture (`server/match.py`)

`match.{M}` in **State** (broadcast + persisted). Default shape: `label`,
`phase`, `stage: draft|live|post`, `scheduledAt` (display text, never parsed),
`format.bestOf`, `series.{1,2}`, `decided` (side 1|2 or None),
`gameMode`, `provider.startgg.setId`, `player.{1,2}` =
`{participantId, rioName, captain, port, seed}`.

- A board binds via `score.{N}.match = M` — **int id, never a round-name
  string**. Unbinding = `State.Unset` + `Match.clear_scoreboard(sb)`.
- **The queue is an ORDER, not a cursor** (`server/schedule.py`). A board takes the
  next fixture waiting for one: `POST /scoreboards/{sb}/next-match` →
  `Schedule.next_up()` + `bind_board`, **both under one `asyncio.Lock`**. Without
  the lock two boards advancing in the same tick resolve the same match and the
  second bind *steals* it, leaving the first board empty.
  - **Never add a stored position.** A PRSH stream can run several matches at once
    (two games side by side; one finishes early and its slot takes the next fixture
    while the other keeps running). A single cursor cannot express that, and a
    queue that assumed one chain would make the common two-board case
    unrepresentable. Because "next" is derived, two boards asking take two
    different matches for free.
  - **Eligible = queued ∧ unbound ∧ `decided is None` ∧ `stage == 'draft'`**
    (`Schedule.is_up_next_eligible`). `decided` is the *finished* test — **not
    `stage`**, because a Bo3 sits at `stage: post` between games and is still the
    current fixture. `stage == 'draft'` is a separate **anti-bounce** test: without
    it, moving a board off an undecided fixture leaves it queued, unbound and
    undecided, so it is instantly "next" again and the verb ping-pongs. A fixture
    mid-lifecycle is bound by hand from the Match desk instead.
  - **The rule is stated once, in `Schedule.not_waiting_reason`**, which returns the
    *reason* (a producer-facing string) and of which `is_up_next_eligible` is just
    `... is None`. Don't reimplement the four conditions anywhere: the verdict and
    the explanation must not be able to disagree about which fixture is next.
    The anti-bounce test is why this matters — `stage` has no server-side writer a
    producer can reach, so a fixture fed once and then unbound sat queued, unbound
    and undecided and was **silently never offered again**, forever, with a badge as
    the only clue. The rule is right; its invisibility was the bug
    (`tests/unit/api/test_schedule_waiting.py` pins the strand).
  - Taking a fixture **does not consume its queue slot** — what stops it being
    "next" is that a board now holds it.
  - **SEVERAL ORDERS.** `schedule.queues` is a list of `{id, title, matches}`; a
    board draws from one (`scoreboards.match_queue.{N}` in Settings — *not* in
    `scoreboards.binding.{N}`, which is pool + playback + stats_tag). Unassigned
    means the first order, so a single-order rig needs no configuration.
    `take_next_match` also accepts `?queue=` to override for one press, which is
    what lets one board pull from Winners now and Losers next.
    - **Membership is exclusive across orders** (mirrors a container's roster): a
      fixture belongs to one, so `append` into another *moves* it. That is what
      makes `queue_of(m)` single-valued, which is why the per-id `move` verb takes
      no queue id from the client at all — a stale read cannot reorder the wrong
      list. `move` is clamped to its own order's ends: position and membership are
      different verbs.
    - **`schedule.queue` is a PROJECTION** of the union, in order, written in the
      same `SetBatch` as the model — the resolve-and-copy pattern. The overlay and
      the console subject read it and needed no change. The union specifically, so
      creating a second order can never drop a fixture off air.
      `schedule.title` stays the overlay's **heading** and is not any order's
      title; projecting the first order's title into it headed a Winners+Losers
      union with the word "WINNERS".
    - **All change detection lives in `Schedule._commit`**, and every verb calls it
      unconditionally. `queues()` prunes ids whose match is gone, so after
      `delete_match` there is nothing left for `remove` to filter — an early-out
      there skipped the write and left the *projection* drawing a deleted fixture on
      the schedule overlay.
    - **Pruning happens on READ, so a path that deletes matches without calling a
      schedule verb must call `Schedule.reproject()`.** `POST /scoreboards/reset`
      unsets `match.{M}` directly: `queues()` and `GET /schedule` answered correctly
      while the *stored* `schedule.queues`/`schedule.queue` still listed every
      deleted fixture — persisted, broadcast, and counted by the console's subject
      row ("3 queued" against no matches). It outlived restarts too, which is why
      `ensure_migrated` now re-projects on an already-migrated rig instead of
      returning flat. `reproject` is a no-op when the model and its projection agree.
  - The client mirrors the rule in `src/routes/production/queue.js` (`useNextUp`)
    **for the button's label only**; the take sends no id. Keep the two in step.
  - **Waiting ≠ next.** `not_waiting_reason` is per fixture, so on a night of fresh
    drafts every one of them is waiting and exactly one is next. Any surface saying
    "this is next" must walk the order — `useNextInOrder(qid)` client-side,
    `next_up(qid)` on the server. The Match desk's stage popover claimed it off the
    reason alone and told eight fixtures they were each next.
  - **Creating a match enrols it** (`create_match` and the from-startgg create path
    both end in `Schedule.append`). A producer authoring eight fixtures should not
    have to enrol each one — before this they could build a night's worth and find
    the schedule overlay empty and every board's Up next silent, with nothing
    saying why. Taking one back out is `DELETE /schedule/queue/{m}`; re-loading a
    set into an *existing* match must not reshuffle the order.
  - **…and it enrols into the order the CALLER names**: `POST /match?queue={qid}`,
    omitted = the first. Enrolment-on-create is only half the answer once a rig has
    two orders — every fixture landed in Winners and had to be *moved* into Losers,
    a second verb on a control (`MembershipControl`) that lives inside the
    fixture's own body, for something the producer knew before they clicked. The
    Match desk's per-order **`+`** is what sends it (the rack's section-header
    idiom), and with several orders the desk-level *New match* is **gone** rather
    than silently meaning the first. 404 on an unknown id *and on an empty one* —
    `get_queue("")` answers with the first by design, so accepting `?queue=` would
    enrol into an order nobody named. Validation runs **before** the match is
    written, so a stale id can't leave an unenrolled fixture behind.
  - **Membership and position are PER-ID verbs**: `POST`/`DELETE`
    `/schedule/queue/{m}` and `POST /schedule/queue/{m}/move?delta=±1`
    (`Schedule.append` / `remove` / `move`, which clamps). The whole-list
    `PUT /schedule` survives for the title, but **the UI must not use it for a
    one-match change** — it sends back the order it read, so anything added
    meanwhile silently vanishes, and enrolment-on-create makes that window real.
    `test_moving_does_not_drop_a_match_added_meanwhile` pins both halves.
  - **The order is authored on the Match desk**, whose accordion stack *is* the
    order (`useQueueOrder` → queued first, then unenrolled). The Upcoming Schedule
    element's stage panel is display-only.
  - Tests: `tests/unit/api/test_schedule_next.py`,
    `tests/unit/api/test_schedule_queue.py`,
    `tests/unit/api/test_schedule_queues.py`,
    `src/routes/production/queue.test.jsx`.
- **`stage` is a constrained input.** `MatchPayload.stage` is
  `Literal["draft", "live", "post"]` because the desk's badge is a control and the
  value gates Up next by an exact match on `"draft"` — an unvalidated string let a
  typo strand a fixture with a reason blaming a stage nothing set.
- **A board id off a request must be in the rig** — `require_board(sb)` (404),
  called by `bind_scoreboard`, `take_next_match` and `/startgg/load-set`. Without
  it, binding to a board outside `scoreboards.active` wrote `score.{sb}.match` for
  a board no layout reads and no rack row lists: persisted phantom state with no
  surface able to show or clear it. The guard is on the **routes**, not in
  `bind_board` — "is this id in the rig" is input validation whose answer is an
  HTTP status, where `bind_board` holds the data invariant for callers that already
  have a real board. Tests binding a multi-board rig use the `rig(...)` conftest
  fixture.
- **A MATCH FILLS EXACTLY ONE BOARD, and `bind_board`
  (`server/api/v1/match.py`) is the only writer of `score.{N}.match`.** Binding
  a match that another board holds **moves** it: vacate the old holder (its
  binding, its `match_conflict`, and the projected keys), then bind. A match
  owns the series score for its fixture, so two boards holding one match is two
  boards claiming one game.
  - Route it through `bind_board`, never a bare `State.Set`. That rule used to
    be a loop in the Match desk's `selectBoard`, so nothing else inherited it:
    the bind route didn't, and `/startgg/load-set` wrote the key directly —
    loading one set onto two boards left it bound to both. The console's version
    also wasn't atomic under confirm mode (each sibling unbind was a separately
    discardable staged entry), so a partial commit produced a state the UI
    cannot draw. A move is **one** staged change.
  - `Match.bound_scoreboards(m)` stays plural — it is the query, and returning a
    list is right whether the answer is 0 or 1 items.
  - Exclusivity is per **match**, not global: a two-board rig runs two fixtures
    at once. The board is single-valued too, so binding a new match to an
    occupied board displaces the old one rather than erroring.
  - Tests: `tests/unit/api/test_match_binding.py` (+ the move assertion in
    `test_load_set_reuses_match_holding_the_set`).
- **The match owns the series; boards own only their live game.**
  `award_game(m, winner_rio)` resolves the winner's side by rioName
  (`side_for_rio` — declines with a warning on mismatch, never guesses),
  increments, sets `decided` when a side reaches `ceil(bestOf/2)` (first
  clinch wins; a dead rubber never flips it), then re-projects.
- The projector copies fixture fields onto bound boards' `score.{N}.*` keys —
  full-key-set, value-or-`""` (see the state-keys-and-projectors skill). It
  writes only fixture/identity keys, never live data (inning/outs/roster) —
  the live feed stays authoritative for those. Special cases: the captain
  guard (a captain-less projection must never blank a live HUD captain) and a
  `gameMode` only writes `stats_tag` when non-empty.
- `flip_sides(m)` swaps the **authored** fixture sides (series wins travel
  with the player) — distinct from live orientation, which `_decide` handles.
- **Primary match** (`PRIMARY_MATCH_ID = 1`): setting its two players
  auto-preps the Matchup band + Player Plates via
  `schedule_primary_sync()` (fire-and-forget; deduped on the rioName pair).
  Both surfaces stay producer-overridable — auto-prep only touches a surface
  still following the primary.

Stage lifecycle: `draft` (authored) → `live` (`note_live(sb)` on first feed
event, guarded to write once) → `post` (post-game capture, or auto-retire).

Those are the only *automatic* transitions, and they only ever move forward — which
is why the **producer can set the stage by hand**, from the Match desk's stage badge
(`StageControl` in `desks/match.jsx`, a `PUT /match/{m}` with `{stage}`). Sending a
played fixture back to `draft` is the way out of the strand above, and it is the
only one. The control is **momentary, not staged**, matching that desk's existing
rule that authoring and lifecycle hops run immediately (Next game is the same write
with a faster path to it); its one broadcast effect is the schedule ticker's LIVE
pill, which should track reality the moment it's corrected. The popover also states
*why* a fixture is not up next, membership first — the console should never make a
producer guess why Up next is silent.

## Player-side cascade (`RioGameDataProvider._decide`, provider.py)

Project Rio randomizes away/home per game. Each HUD frame,
`_apply_game_to_state` decides orientation **per board**:

**Precedence: manual > match > pin > back_to_back > none**

| Layer | Source | Returns None when |
|---|---|---|
| manual | swap button → `_user_overridden` + `_sides_swapped` | not overridden |
| match | `Match.orientation_for_sides(sb, left, right)` | board unbound, or live players don't match the fixture |
| pin | `project_rio.pinned_player` + `pinned_side` Settings | no pin, or pinned player not in this game |
| back_to_back | `_prev_player_sides` from the previous game | no prior game / neither player returning |

- The deciding layer is mirrored to `score.{N}.side_reason`, and the board desk
  (`src/routes/production/desks/board.jsx`, `sideReasonLine`) is what reads it —
  one sentence per layer. A new layer needs a sentence there or the board will
  state nothing about it.
- Manual scope = current game only: `_preserve_player_sides` clears
  `_user_overridden` on a new game (inning decreased) and reseeds the manual
  base from the non-manual cascade; a mid-game swap **back to** the pinned
  orientation releases the override early.
- `_decide(sb=None)` is the global, match-agnostic orientation used for
  `current_game` + back-to-back tracking — stable across per-board match
  bindings.
- The manual swap path (`toggle_sides_swapped`) carries display identity and
  `rioName_override` across sides; with no live frame it swaps board state
  directly (`_swap_current_state_sides`). The server is the single
  authoritative swap — the client defers entirely.
- Tests encoding this: `tests/unit/rio/test_side_preservation.py`. Change
  behavior and tests **in the same commit**.

## Per-game identity gate (`Match.gate_state` + provider `_gate_board`)

On each new game (and on bind/re-bind via
`evaluate_match_gate_for_board`), live players are checked against the bound
fixture:

- `nogate` — unbound, or fixture has no participants.
- `ok` — a participant resolves; carries the orientation swap.
- `conflict` — neither live player matches an **undecided** match → writes
  `score.{N}.match_conflict` (app-wide banner). Never auto-clears the match;
  the producer resolves.
- `retire` — neither matches but the match is **decided** → auto-retire:
  unbind the board, stamp `match.{M}.stage = "post"`, blank the projection.
  The match object survives with its final series.

## Game-end detection → series credit

Two mutually-exclusive paths (a match binds to one board):

- **HUD board (1)**: post-game stat-file capture (`server/postgame.py`),
  gated on GameID + `Loaded-from-HUD == 0`, credits via `Match.award_game`.
- **API boards**: `GameEndWatcher` (`server/rio/game_end.py`) fires when a
  followed game **drops out of the ongoing feed**. Candidate criteria: api
  transport, not rotating, `playback.gameId` matches, bound **undecided**
  match. Winner lookup: one-shot completed-games fetch by the username
  pairing, accepting only games started at/after the followed game (300s
  slack), retried 12×10s. A crashed game lingers in ongoing forever → never
  fires → producer resolves by hand. Name mismatch = decline, not retry.

## start.gg (the only tournament provider)

`apply_startgg_set` (`server/api/v1/match.py`) is the **single** set→match
path — both the API route and the bracket view's "Load to Match" use it. It
upserts entrants into the participant registry, maps roundName→`label`, phase
name→`phase`, `totalGames`→`format.bestOf`, reported score→`series` seed, and
records `provider.startgg.setId`. Unseeded phases produce string preview ids
(`preview_…`) — set ids are `int | str` everywhere.

**There is no direct set→score path, and no other provider.** Challonge was
fully removed in July 2026 — do not reintroduce provider branching or write
`score.{N}.match` from anywhere but `bind_board`. `/startgg/load-set` binds
through it with `project=False`, because `apply_startgg_set` already ends in
`project_match` + `_regate_bound_boards` and a fixture must not be projected
twice — once empty, then once filled.
