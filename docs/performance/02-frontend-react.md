# Performance Review: Frontend React/Zustand Issues

This document covers performance problems in the React frontend that compound with the backend issues to cause stuttering.

---

## The Amplification Problem

The backend sends 33+ individual `v1.state.set` SocketIO events per HUD update. Each one triggers:

```
SocketIO message received
  → Zustand setItem()
    → assocPath(key.split("."), value, state)  // new immutable state tree
    → socketio.emit() back to server (echo!)    // unnecessary round-trip
  → React re-render of all subscribers to any part of the changed path
    → PlayerSlot: 11 separate selectors, no React.memo
    → Roster grid: 9 elements recreated
    → ScoreControls: batter/pitcher selects rebuilt
```

**Per HUD event: 33 Zustand state updates → 33 immutable tree copies → potentially 33 × N component re-renders.**

---

## Issue 1: No React.memo on PlayerSlot (CRITICAL)

**File:** `src/components/scoreboard/PlayerSlot.jsx:31`

`PlayerSlot` is a plain function component — not wrapped in `React.memo()`. This means every time its parent (`TeamPanel`) re-renders, both PlayerSlot instances re-render regardless of whether their data changed.

Each PlayerSlot has:
- 11 separate `useStateStore()` selector calls (lines 37-57)
- A 9-element roster grid (lines 184-231)
- Collapse sections with multiple inputs (lines 116-164)

**Impact:** A single score change causes TeamPanel to re-render, which forces both PlayerSlots to rebuild their entire DOM tree — including 9 character grid cells, even though player data didn't change.

**Fix:** Wrap in `React.memo()` and consolidate selectors.

---

## Issue 2: 11 Independent Zustand Selectors Per PlayerSlot (HIGH)

**File:** `src/components/scoreboard/PlayerSlot.jsx:37-57`

```javascript
const name       = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.name ?? '');
const teamPrefix = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.team ?? '');
const rioName    = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.rioName ?? '');
// ... 8 more
```

Each selector is a new inline arrow function on every render. Zustand uses reference equality for selectors — new function references mean Zustand can't optimize subscription checks.

**Fix:** Use a single selector with Zustand's `useShallow`:
```javascript
const playerData = useStateStore(
  useShallow(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber])
);
const { name, team, rioName, msbTeam, ... } = playerData ?? {};
```

This reduces 11 subscriptions to 1 and enables shallow equality comparison.

---

## Issue 3: Roster Array Rebuilt Every Render (HIGH)

**File:** `src/components/scoreboard/PlayerSlot.jsx:54-57, 184-231`

```javascript
const roster = [];
for (let i = 0; i < ROSTER_SIZE; i++) {
    roster.push(useStateStore(s => s?.score?.[...].character?.[i]?.name ?? ''));
}
```

This creates 9 more `useStateStore` subscriptions and builds a new array every render. The array is then mapped into JSX (line 184) without memoization.

**Fix:** Read the entire character object with one selector and derive roster:
```javascript
const characters = useStateStore(
  useShallow(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.character)
);
const roster = useMemo(() =>
  Array.from({length: ROSTER_SIZE}, (_, i) => characters?.[i]?.name ?? ''),
  [characters]
);
```

---

## Issue 4: Zustand setItems Emits Per-Key to Server (HIGH)

**File:** `src/context/store.jsx:18-30`

```javascript
setItems: (entries, emit=true) => {
    set(state => {
        let s = state;
        for (const { key, value } of entries) {
            s = assocPath(key.split("."), value, s);  // N immutable copies
        }
        return s;
    });
    if(emit && _socketRef) {
        for (const { key, value } of entries) {
            _socketRef.emit('v1.state.set', { key, value });  // N separate emits!
        }
    }
},
```

Even though the Zustand state update is batched (single `set()` call), the SocketIO emissions loop and send N separate messages. The server then processes each independently.

**Fix:** Emit a single batch message:
```javascript
if (emit && _socketRef) {
    _socketRef.emit('v1.state.batch', { entries });
}
```

---

## Issue 5: assocPath Creates Full Tree Copy Per Key (MEDIUM)

**File:** `src/context/store.jsx:13, 22`

Ramda's `assocPath` creates a new immutable copy of every object along the path. For a key like `score.1.team.1.player.1.character.0.name`, that's 8 levels of object spreading.

In `setItems()`, this happens in a loop — N keys means N full tree traversals.

**Fix for setItems:** This is already somewhat mitigated since each iteration builds on the previous result `s`. But `key.split(".")` is called each time (string allocation). Pre-split keys would help marginally.

The bigger fix is to reduce the number of individual key updates by restructuring the state to use fewer, coarser keys (e.g., set the entire player object at once rather than individual fields).

---

## Issue 6: renderCharOption Not Memoized (MEDIUM)

**File:** `src/components/scoreboard/ScoreControls.jsx:14-18`

```javascript
const renderCharOption = ({ option }) => (
    <Group gap="xs" wrap="nowrap">
        <img src={charIconUrl(option.value)} ... />
        <span>{option.label}</span>
    </Group>
);
```

This is defined at module scope (good), but `charIconUrl()` returns a new string on each call, and the JSX is recreated on each render of the parent Select component.

**Fix:** This is actually fine at module scope — the real issue is that parent re-renders pass new `renderOption` prop references to Select. The Select should be memoized or extracted into a stable component.

---

## Issue 7: Diagnostics Polling at 500ms (MEDIUM)

**File:** `src/components/scoreboard/ScoreControls.jsx:202-219`

```javascript
pollRef.current = setInterval(() => {
    fetch('/api/v1/rio/stats/diagnostics')
        .then(r => r.json())
        .then(d => {
            setDiagnostics(d);  // Re-render on every poll
            if (d.status !== 'loading') {
                clearInterval(pollRef.current);
            }
        });
}, 500);
```

During stats loading, this fires every 500ms, each time causing a state update + re-render of the ScoreControls component tree.

**Fix:**
- Use a longer interval (1-2 seconds) — stats loading isn't time-critical
- Avoid re-rendering if diagnostics data hasn't actually changed
- Use `AbortController` to cancel in-flight requests

---

## Issue 8: StatLine Component Not Memoized (LOW-MEDIUM)

**File:** `src/components/scoreboard/ActiveMatchupStats.jsx:29-54`

`StatLine` derives batting/pitching stats on every render without `React.memo` or `useMemo`:

```javascript
function StatLine({ label, stats, type, scope }) {
    const derived = type === 'batting' ? deriveBatting(raw) : derivePitching(raw);
}
```

Called twice per `ActiveMatchupStats` render.

**Fix:** Wrap in `React.memo()` and memoize `derived`.

---

## Issue 9: RunnerTile Grid Recreated Per Render (LOW-MEDIUM)

**File:** `src/components/scoreboard/ScoreControls.jsx:94-139`

Each of 3 `RunnerTile` components recreates a character icon grid on render with inline `onClick` handlers:

```javascript
{rosterOptions.map(opt => (
    <UnstyledButton onClick={() => { onSelect(opt.value); setOpened(false); }} ... />
))}
```

New function references on every render prevent React from skipping updates.

**Fix:** Wrap `RunnerTile` in `React.memo()`, memoize `rosterOptions.map()`, extract click handler.

---

## Summary: Frontend Re-render Cascade

For a single HUD event (e.g., ball count changes from 1 to 2):

### Current behavior:
1. Backend sends `v1.state.set` for `score.1.balls = 2` (plus 32 other unchanged values)
2. Frontend receives 33 SocketIO messages
3. Each triggers `setItem()` → `assocPath()` → new state tree → all subscribers notified
4. `ScoreControls` re-renders (subscribed to score data)
5. `PlayerSlot` ×2 re-renders (subscribed via 20 selectors total)
6. Each PlayerSlot rebuilds 9-element roster grid
7. `ActiveMatchupStats` re-derives batting/pitching stats
8. Total: **~50-100 component renders** for a single ball count change

### After optimization:
1. Backend sends 1 `v1.state.batch` with only changed keys
2. Frontend receives 1 SocketIO message
3. Single `setItems()` → 1 state tree update → subscribers notified once
4. Only `ScoreControls` re-renders (balls changed)
5. `PlayerSlot` skipped by `React.memo` (player data unchanged)
6. `ActiveMatchupStats` skipped (stats unchanged)
7. Total: **~3-5 component renders**

**Estimated reduction: 90-95% fewer renders per HUD event.**
