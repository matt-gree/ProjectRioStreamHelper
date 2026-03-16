# Performance Optimization: Prioritized Action Plan

Organized by expected impact on the game-loading stutter you're experiencing.

---

## Phase 1: Eliminate the Hot Path Bottleneck (Highest Impact)

These changes target the core issue — the avalanche of async work triggered by each HUD file change.

### 1.1 Add State.SetBatch() and use it everywhere
**Files:** `server/state.py`, `server/rio/provider.py`

Replace 33+ sequential `await State.Set()` calls with a single batch operation:

```python
# New method on State
@classmethod
async def SetBatch(cls, entries: dict, session_id=None):
    for key, value in entries.items():
        await deep_set(cls.state, key, value)
        cls._add_changed_key_sync(key)  # sync version, no task creation
    # Single SocketIO emit with all changes
    await socketio.emit('v1.state.batch', {"entries": entries, "sid": session_id})
```

Update `apply_parsed_game_to_state()` to build a dict and call SetBatch once.

**Expected improvement:** ~95% reduction in asyncio task creation per HUD event.

### 1.2 Replace DeepDiff with simple changed-key diffing
**File:** `server/state.py`

We already track `changed_keys`. Remove the DeepDiff dependency entirely:

```python
@classmethod
async def Save(cls):
    if not cls.changed_keys:
        return
    changes = {}
    for key in cls.changed_keys:
        new_val = await deep_get(cls.state, key)
        old_val = await deep_get(cls.last_state, key)
        if new_val != old_val:
            changes[key] = {"old": old_val, "new": new_val}
    cls.changed_keys = []
    if changes:
        await cls.queue.put(partial(cls.Export, changes=changes))
```

**Expected improvement:** Eliminate heavy library computation from every save cycle.

### 1.3 Replace msgpack deep_clone with selective snapshots
**File:** `server/state.py`, `server/utils/deep_dict.py`

Instead of cloning the entire state dict after every export, just snapshot the changed keys:

```python
# After export, update last_state selectively
for key, change in changes.items():
    deep_set(cls.last_state, key, change["new"])
```

**Expected improvement:** Eliminate ~2 msgpack serialize/deserialize cycles per HUD event.

### 1.4 Add SocketIO batch support to frontend
**File:** `src/context/store.jsx`, socket connection setup

Add handler for `v1.state.batch` events that calls `setItems()` once:

```javascript
socket.on('v1.state.batch', ({ entries }) => {
    const items = Object.entries(entries).map(([key, value]) => ({ key, value }));
    useStateStore.getState().setItems(items, false);  // emit=false to prevent echo
});
```

**Expected improvement:** 33 React update cycles → 1 per HUD event.

---

## Phase 2: Frontend Render Optimization (High Impact)

### 2.1 Wrap PlayerSlot in React.memo
**File:** `src/components/scoreboard/PlayerSlot.jsx`

```javascript
export default React.memo(function PlayerSlot({ ... }) { ... });
```

### 2.2 Consolidate Zustand selectors with useShallow
**File:** `src/components/scoreboard/PlayerSlot.jsx`

Replace 11 + 9 separate selectors with 1-2 using Zustand's `useShallow`:

```javascript
import { useShallow } from 'zustand/react/shallow';

const player = useStateStore(useShallow(
    s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]
));
```

### 2.3 Memoize roster grid
**File:** `src/components/scoreboard/PlayerSlot.jsx`

```javascript
const rosterGrid = useMemo(() =>
    roster.map((name, i) => <Grid.Col key={i}>...</Grid.Col>),
    [roster]
);
```

### 2.4 Stop echo emits from frontend
**File:** `src/context/store.jsx`

When the frontend receives a state update via SocketIO, it currently re-emits back to the server (because `setItem` always emits). This creates unnecessary round-trips.

Fix: Use `emit=false` when processing incoming SocketIO state updates.

**Combined Phase 2 improvement:** ~90% fewer component re-renders per state change.

---

## Phase 3: I/O and Resource Optimization (Medium Impact)

### 3.1 Make file export optional (default off)
**File:** `server/state.py`

The recursive file export to `./user_data/stream_labels/` exists for OBS text sources. If you're using browser sources (SocketIO), this entire I/O pipeline is waste.

Add a setting `general.disable_export = true` by default. It's already partially implemented (line 27) but defaults to false.

### 3.2 Batch file writes when export is enabled
**File:** `server/state.py`

If export is needed, batch all file operations into a single `asyncio.to_thread()` call:

```python
@classmethod
async def _batch_export_files(cls, changes):
    def _sync_write_all():
        for path, value in changes.items():
            filepath = cls._stream_labels_out / f"{path}.txt"
            filepath.parent.mkdir(parents=True, exist_ok=True)
            filepath.write_text(str(value))
    await asyncio.to_thread(_sync_write_all)
```

### 3.3 Add Settings debounce
**File:** `server/settings.py`

Add 200ms debounce before writing settings.json to disk (the old TSH had this).

### 3.4 Switch HUD watcher to event-based
**File:** `server/rio/hud_watcher.py`

Replace 100ms polling with `watchfiles` library (uses kqueue on macOS):

```python
from watchfiles import awatch
async for changes in awatch(self.hud_file):
    game = await asyncio.to_thread(self._read_and_parse)
    if game is not None:
        await self.on_update(game)
```

This eliminates 10 `os.stat()` calls/sec when no changes are happening.

### 3.5 Index StatsTracker DataFrame
**File:** `server/rio/stats_tracker.py`

Replace pandas mask lookups with pre-built dict:

```python
cls._api_index = {
    (row["username"], row["char_name"]): row
    for _, row in cls._api_stats.iterrows()
}
```

Then O(1) lookup: `cls._api_index.get((username, char_name))`

---

## Phase 4: Architectural Cleanup (Lower Priority, Good for Packaging)

### 4.1 Remove pandas dependency
Replace the DataFrame usage in StatsTracker with plain dicts. Pandas is a 50+ MB dependency that's used only for simple row lookups.

### 4.2 Cache hot-path settings
Cache `scoreboards.hud_target` and pin settings as class variables on `RioGameDataProvider`, updated only via settings change callback.

### 4.3 Fix asyncio.wait usage
**Files:** `server/state.py`, `server/settings.py`

Replace `asyncio.wait([...])` with `asyncio.gather(...)` — the current usage doesn't check return values and could silently drop exceptions.

### 4.4 Remove bare except blocks
**File:** `server/state.py` (lines 68, 82, 112, 172, 191, 198, 222, 228, 235)

Replace with specific exception types to avoid hiding real errors.

### 4.5 Reduce orjson thread overhead for small payloads
**File:** `server/utils/json.py`

For small payloads (< 1KB), call `orjson.loads/dumps` directly without `asyncio.to_thread()`:

```python
async def loads(data, *args, **kwargs):
    if len(data) < 1024:
        return orjson.loads(data, *args, **kwargs)
    return await to_thread(orjson.loads, data, *args, **kwargs)
```

---

## Implementation Order

| Order | Task | Est. Effort | Impact |
|-------|------|-------------|--------|
| 1 | State.SetBatch + provider batching | 2-3 hours | Massive |
| 2 | SocketIO batch protocol (backend + frontend) | 1-2 hours | Large |
| 3 | Remove DeepDiff, use changed-key tracking | 1-2 hours | Large |
| 4 | Remove deep_clone, selective snapshots | 1 hour | Large |
| 5 | PlayerSlot React.memo + selector consolidation | 1-2 hours | Large |
| 6 | Disable file export by default | 15 min | Medium |
| 7 | Frontend: stop echo emits | 30 min | Medium |
| 8 | Settings debounce | 30 min | Medium |
| 9 | Event-based HUD watching | 1 hour | Medium |
| 10 | StatsTracker index + remove pandas | 1-2 hours | Medium |
| 11 | Cleanup (asyncio.wait, bare excepts, etc.) | 1 hour | Low |

**Tasks 1-4 alone should eliminate your stutter.** They reduce the per-HUD-event workload from ~200 async operations to ~10.

---

## Quick Validation Test

After implementing Phase 1, you can verify improvement by:

1. Adding timing to `_on_hud_game_update`:
```python
import time
start = time.perf_counter()
# ... existing code ...
logger.debug(f"HUD event processed in {(time.perf_counter() - start)*1000:.1f}ms")
```

2. Target: each HUD event should process in < 5ms (currently likely 50-200ms)

3. Monitor with `py-spy` during a game to confirm no CPU spikes:
```bash
pip install py-spy
py-spy top --pid $(pgrep -f "python main.py")
```
