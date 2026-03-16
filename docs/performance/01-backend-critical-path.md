# Performance Review: Backend Critical Path (HUD → State → Export)

This document covers the hot path that fires every time the HUD file changes during gameplay — the primary cause of the stuttering you experienced.

---

## The Problem Pipeline

Every 100ms during an active game, this cascade runs:

```
HudWatcher polls file (100ms loop)
  → os.stat() in thread pool
  → full file read + orjson parse + HudObj creation (in thread)
  → _convert_hud_data_format: 44 method calls to build flat dict
  → _on_hud_game_update callback (async)
    → StatsTracker.on_hud_update: 18 dict extractions
    → parse_game_data: iterate rosters again
    → _preserve_player_sides: settings reads + swap logic
    → apply_parsed_game_to_state: 33+ sequential await State.Set() calls
      → Each State.Set():
        → deep_set (string split + dict traversal)
        → asyncio.wait([_add_changed_key, socketio.emit])  ← 2 tasks created
      → Total: ~66 asyncio tasks created per HUD event
    → State.Save()
      → DeepDiff (in thread) comparing full state dicts
      → Queue Export task
        → deep_clone via msgpack serialize+deserialize of ENTIRE state
        → SaveImmediately: orjson.dumps full state to disk
        → Recursive file creation: 1 file write per changed leaf value
    → StatsTracker.push_stats_to_state
      → 18 pandas DataFrame mask operations
      → 36+ more State.Set() calls for stats
      → Another State.Save() → another DeepDiff + Export cycle
```

**Per HUD event total: ~100+ State.Set() calls, ~200 asyncio tasks, 2 DeepDiff operations, 2 msgpack clone cycles, 50+ file I/O operations.**

At 10 events/second during gameplay, this is **~1000 State.Set calls/sec** and **~2000 asyncio task creations/sec**.

---

## Issue 1: No State Batching (CRITICAL)

**Files:** `server/rio/provider.py:40-77`, `server/state.py:124-135`

`apply_parsed_game_to_state()` makes 33+ sequential `await State.Set()` calls, each of which:
1. Calls `deep_set()` (string split + dict walk)
2. Creates 2 asyncio tasks (one for key tracking, one for SocketIO emit)
3. Awaits both with `asyncio.wait()`

```python
# provider.py:47-61 — 15 sequential awaited calls
await State.Set(f"{sb}.score_left", parsed.get("team1score", 0))
await State.Set(f"{sb}.score_right", parsed.get("team2score", 0))
await State.Set(f"{sb}.inning", parsed.get("inning", 1))
# ... 12 more
```

Then another 18 calls for roster data (lines 69-75), then `State.Save()` triggers the expensive export pipeline. Then `StatsTracker.push_stats_to_state()` does it all AGAIN with ~36 more State.Set() calls + another Save().

**Fix:** Add a `State.SetBatch(entries: dict)` method that:
- Updates all keys in one pass
- Emits a single SocketIO event with all changes
- Tracks changed keys in bulk
- Calls Save() once at the end

This alone would reduce asyncio task creation from ~200/event to ~4/event.

---

## Issue 2: DeepDiff + msgpack Clone on Every Save (CRITICAL)

**File:** `server/state.py:71, 87-92`

Every `State.Save()` runs `DeepDiff` (a heavy library) in a thread to compare `last_state` vs `state`. Then after Export, the entire state is cloned via msgpack:

```python
# state.py:87-92
diff = await asyncio.to_thread(DeepDiff, cls.last_state, cls.state, include_paths=cls.changed_keys)

# state.py:71
cls.last_state = await deep_clone(cls.state)  # msgpack packb + unpackb
```

This is completely unnecessary given that we already track changed keys in `cls.changed_keys`. The system knows exactly which keys changed — there's no need for DeepDiff at all.

**Fix:** Replace DeepDiff with direct changed-key tracking:
- `State.Set()` already calls `_add_changed_key()`
- On Save, just iterate `changed_keys` and read old/new values directly
- Replace `deep_clone()` with selective snapshotting of only changed keys
- Or simply store old values at Set() time: `old_values[key] = current_value` before update

---

## Issue 3: Recursive File Export (HIGH)

**File:** `server/state.py:176-207`

Every changed key triggers recursive file creation with individual async I/O calls:

```python
# state.py:176-207
async def _create_files_dict(cls, path, di):
    # mkdir for intermediate dirs (async I/O)
    # if dict: recurse for each key
    # if leaf: write individual .txt file (async I/O)
```

For a single character name change (`score.1.team.1.player.1.character.0.name`), this does:
- 1 `is_dir()` check
- 1 `mkdir()` call
- 1 `write_text()` call

Multiplied by 33+ changed keys per HUD event = 100+ async file I/O operations.

**Fix:**
- Batch all file writes into a single operation using `asyncio.to_thread()` with synchronous bulk I/O
- Cache directory existence (dirs don't disappear between writes)
- Better yet: make file export optional and off by default (it exists for legacy OBS text source compatibility, but browser sources use SocketIO)

---

## Issue 4: SocketIO Emits Per-Key Instead of Batched (HIGH)

**File:** `server/state.py:128-134`

Each `State.Set()` emits a separate SocketIO message:

```python
socketio.emit('v1.state.set', {"key": key, "value": value, "sid": session_id})
```

With 33+ Set calls per HUD event, the frontend receives 33+ individual WebSocket frames and processes each one (Zustand `assocPath` + React re-render) independently.

**Fix:** Emit a single `v1.state.batch` event with all changes:
```python
socketio.emit('v1.state.batch', {"entries": [{"key": k, "value": v} for k, v in changes], "sid": session_id})
```

Frontend `setItems()` already supports batch updates — this would reduce 33 React render cycles to 1.

---

## Issue 5: HUD Polling Creates Thread Pool Pressure (MEDIUM)

**File:** `server/rio/hud_watcher.py:53-67`

Polls every 100ms with `asyncio.to_thread()` for both mtime check and file read:

```python
async def _watch_loop(self):
    while True:
        mtime = await asyncio.to_thread(self._get_mtime)  # Thread 1
        if mtime changed:
            game = await self.reload()  # Thread 2 (read + parse)
            await self.on_update(game)  # Triggers 100+ async operations
        await asyncio.sleep(0.1)
```

20 thread context switches per second minimum (even when file hasn't changed).

**Fix options:**
- Use `watchfiles` library (wraps `inotify`/`kqueue`) for event-based watching instead of polling
- Or increase poll interval to 250ms (HUD data doesn't change faster than pitcher-batter events)
- Add content hashing to skip redundant parses when mtime changes but data is identical

---

## Issue 6: Double Processing Pipeline (MEDIUM)

**File:** `server/rio/provider.py:232-249`

On every HUD event, data is processed through 3 redundant passes:

1. `StatsTracker.on_hud_update(game_json)` — iterates all 18 roster slots
2. `parse_game_data(game_json)` — iterates rosters again
3. `StatsTracker.push_stats_to_state()` — iterates rosters a third time with DataFrame lookups

**Fix:** Single-pass processing:
- Parse game data once, extract stats in the same pass
- Cache parsed result until next HUD change
- Move stats push into the batch state update

---

## Issue 7: StatsTracker DataFrame Lookups (MEDIUM)

**File:** `server/rio/stats_tracker.py` (referenced from provider.py:249)

`push_stats_to_state()` does 18 pandas DataFrame mask operations per HUD event:

```python
mask = (cls._api_stats["username"] == username) & (cls._api_stats["char_name"] == char_name)
rows = cls._api_stats[mask]  # O(n) filter per character
```

18 characters × 10 events/sec = 180 DataFrame filter operations per second.

**Fix:** Pre-index the DataFrame into a dict `{(username, char_name): row}` after API fetch, then do O(1) lookups.

---

## Issue 8: Settings Reads in Hot Path (LOW-MEDIUM)

**File:** `server/rio/provider.py:153, 226, 248`

Three `await Settings.Get("scoreboards.hud_target", 1)` calls per HUD event, each going through `deep_get()` with string splitting and dict traversal.

**Fix:** Cache `hud_target` as a class variable on `RioGameDataProvider`, update only when settings change.

---

## Issue 9: No Settings Debounce (LOW-MEDIUM)

**File:** `server/settings.py:90-101`

Every `Settings.Set()` immediately writes the full settings.json to disk + emits SocketIO. No debouncing.

The old TSH had 200ms debounce. This new implementation has none.

**Fix:** Add a 200-500ms debounce timer before disk write, similar to old StateManager pattern.

---

## Estimated Impact of Fixes

| Fix | Reduction | What it saves |
|-----|-----------|---------------|
| State batching | ~95% fewer asyncio tasks | 200→4 tasks per HUD event |
| Remove DeepDiff | ~100% of diff CPU cost | Eliminate heavy library from hot path |
| Remove deep_clone | ~100% of clone cost | No more msgpack serialize/deserialize |
| Batch SocketIO | ~95% fewer WS frames | 33→1 frame per HUD event |
| Batch file export | ~80% fewer I/O calls | 100→20 file operations |
| Index DataFrame | ~90% faster stat lookups | O(1) instead of O(n) per character |
| Cache settings | ~100% fewer hot-path reads | 3 async calls eliminated per event |

**Combined: the hot path would go from ~200+ async operations per HUD event to ~10-15.**
