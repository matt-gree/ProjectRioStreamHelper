---
name: state-keys-and-projectors
description: PRSH central State store contract (Set/SetBatch/Save/SocketIO emit), the full state-key namespace map, the Settings-vs-State split, and the resolve-by-copy projector pattern — read before writing any state key, adding a state namespace, or building a new projected element (a 5th sibling of Match/Commentary/PlayerPlates/PostGame).
---

# State Keys & Projectors

## The State contract (`server/state.py`)

`State` is a class-level singleton. Every broadcastable fact flows through it.

```python
await State.Set(key, value)            # one key → one 'v1.state.set' emit
await State.SetBatch([(k, v), ...])    # N keys → ONE 'v1.state.set_batch' emit
await State.Unset(key)                 # 'v1.state.unset'
await State.UnsetBatch([k, ...])       # 'v1.state.unset_batch'
await State.Save()                     # diff changed_keys → persist + stream labels
value = await State.Get(key, default)  # deep_get; sync read: deep_get(State.state, key)
```

Critical semantics:

- **Set/SetBatch emit immediately but do NOT persist.** `Save()` is what writes
  `state.json` (atomic tmp+rename) and stream-label files. The standard write is
  always the pair: `await State.SetBatch(entries)` then `await State.Save()`.
- **`Save()` diffs only `changed_keys`** against `last_state` — never a
  full-state diff. Do not reintroduce DeepDiff/full-state cloning.
- **Multi-key writes MUST use `SetBatch`.** One HUD event touches 30–100+ keys;
  per-key `Set` calls emit that many socket frames and stall OBS overlays.
- Keys are dotted paths into nested dicts. Numeric segments are **string** dict
  keys: `score.1.inning` lives at `State.state["score"]["1"]["inning"]`.
- `session_id` (optional) is echoed as `sid` in the emit so the originating
  frontend client can skip its own write.
- Consumers must handle **both** `v1.state.set` and `v1.state.set_batch` (plus
  the unset variants). Overlays get this for free via `OverlayBase.init`;
  anything hand-rolled must implement all four.

## Settings vs State — which store does a key belong in?

| Store | Persisted to | Broadcast | Belongs there |
|---|---|---|---|
| `State` (`server/state.py`) | `user_data/state.json` | yes — `v1.state.*` | anything an overlay or the UI renders live: `score.*`, `match.*`, element keys |
| `Settings` (`server/settings.py`) | `user_data/settings.json` | `v1.settings.set` | configuration: `scoreboards.active/aliases/binding.{N}`, `project_rio.*`, `overlays.*` style knobs, `server.*` |

The classic trap: **scoreboard bindings are Settings, not State.**
`scoreboards.binding.{N}` (pool + playback + stats_tag, schema in
`server/bindings.py`) is a Settings key. The State-side
`scoreboards.rotation.{N}.*` is a **read-only mirror** written by `PoolManager`
for overlays — never write config there. Legacy `scoreboards.sources` / flat
`scoreboards.rotation` Settings keys are migration fallbacks — never write them.

## State namespace map

```
score.{N}.*                    per-board live game + projected fixture (N ≥ 1, board 1 always exists)
  inning, half_inning, outs, strikes, balls, batter, pitcher,
  cbRioRunnerOn1/2/3, runner{1,2,3}Name, star_chance, stadium,
  innings_selected, tag_set, best_of, phase, game_id,
  score_left, score_right, away_linescore, home_linescore, home_team,
  match            ← bound match id (int; unset when unbound)
  match_conflict   ← identity-gate conflict dict {active, matchId, expected, feed} | None
  series_decided   ← projected match winner side (1|2) or ""
  side_reason      ← which cascade layer decided orientation: manual|match|pin|back_to_back|""
  hit.*            ← hit-visualizer payload (id bumps per contact)
  player.{T}.*     (T ∈ {1,2}: 1=left, 2=right — never "away/home")
    rioName, rioName_override (producer pin, cleared each new HUD game),
    name, team, full_name, pronoun, country, state, twitter, youtube,  ← display identity (RESURFACE_MAP targets)
    rio_captainIndex, msb_team, logo, port, team_stars, series_wins,
    character.{C}.{name, position, is_starred, batting_hand, fielding_hand}

match.{M}.*                    fixture (see match-binding-lifecycle skill)
commentary.slots + commentary.{0..3}.*   desk: authored list + projected slots
playerplates.mode + playerplates.{1,2}.* plates band (projected: name/subLabel/subValue/subVisible/location/active)
matchup.*                      head-to-head band (singleton, incl. matchId)
postgame.{N}.*                 captured post-game (present, gameId, meta, player.{T}.totals)
lowerthird.slots.{1..5}.*      lower-third band
schedule.queue                 upcoming-matches queue
scoreboards.rotation.{N}.*     live rotation status MIRROR (PoolManager-owned, read-only)
tournamentInfo.*               tournament metadata (bracket_link etc.)
overlays.*                     (in Settings, not State — style knobs)
production.*                   Production-page element/feed state
```

Adding a new namespace: no registration needed server-side (State is
schema-less), but the frontend store (`src/context/store.jsx`) and any overlay
`shouldRender` prefix filters must know about it, and the namespace map **above
in this skill** must be updated in the same change (CLAUDE.md keeps only a
pointer — this map is the source of truth).

## The projector pattern (resolve-by-copy)

Four modules follow it — `server/match.py`, `server/commentary.py`,
`server/playerplates.py`, `server/postgame.py`. **Reuse the shape; do not
invent a new one.** `server/commentary.py` is the cleanest reference
implementation.

The shape:

1. **Authored data** lives in one State key (e.g. `commentary.slots`,
   `match.{M}.player.{T}`) — participant ids + choices, not display values.
2. **A blank-key-set constant** enumerates every projected key the projector
   owns (`_BLANK_SLOT`, `_PLAYER_KEYS`). A projection **always writes the full
   set** — resolved value or `""` — so re-projection is deterministic and
   unbinding/clearing blanks exactly what was set. No stale caster/fixture left
   on air.
3. **`_project_entries()`** resolves authored records against the
   `Participants` registry (`server/participants.py`) and returns
   `[(key, value), ...]`. The registry itself never goes on the wire — only
   resolved display values.
4. **`project()`** = `await State.SetBatch(entries)` + `await State.Save()`.
5. **`project_all()`** is the startup hook (called from `server/server.py`),
   wrapped in `try/except` with `logger.exception` — a bad persisted record
   must never block boot.
6. Re-projection triggers: every authored-data mutation, and startup. An
   address-book edit re-flows on the next mutation/restart (not live).

Known deliberate deviations (don't "fix" them):

- **Match captain guard** (`Match._side_entries`): a captain-less match
  projection *drops* `character.0.name` + `rio_captainIndex` from the batch
  when the board side already has data — binding a captain-less match must
  never blank a live HUD captain. Only an empty side gets blanked.
- **`Match.identity_entries`** is enrich-only (writes non-empty values,
  appended last in the feed's SetBatch so the drafted identity wins) — it
  never blanks.
- `RESURFACE_MAP` (`server/rio/resurface.py`) is the shared registry→score
  field mapping used by both the provider resurface path and the Match
  projector. Change it in one place; it mirrors `src/lib/participants.js`.

## Checklist: adding a 5th projected element

1. Model module `server/<element>.py`: stateless class-method singleton, the
   blank-key-set constant, `_normalize_*` for authored input,
   `_project_entries` / `project` / `project_all` per the shape above.
2. API routes in `server/api/v1/<element>.py` (decorate with `@method` from
   `server/utils`), register the router in `server/api/__init__.py`.
3. Call `<Element>.project_all()` in the startup sequence in
   `server/server.py`, alongside the existing four.
4. Overlay: thin HTML shell + `lib/<element>-mount.js` reading the projected
   keys (see the overlay-authoring skill).
5. Producer UI: register in `src/routes/production/elements.js` if it's a
   Production element.
6. Tests: unit-test `_project_entries` (full-key-set invariant: a cleared slot
   yields all-blank entries) using the autouse conftest fixtures.
7. Update CLAUDE.md's namespace table + module list, and this skill's list of
   projector modules.
