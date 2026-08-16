# OBS mirror & the offline catalog tier

> Reference for `production-console-contract`. Load when touching the scene mirror, or console behavior with OBS disconnected.

## With no OBS: the catalog tier

`catalogPlacements` + `useConsoleOffline` (`placements.js`). **OBS is the control
surface, not the content pipeline.** Source → row is right when there is a source;
with OBS closed there is none, and the console used to collapse to three desk
rows and an apology — no row to select, so no stage, so no way to author a lower
third, build a container, set a scorecard's bands or preview any of it.
Everything the console does that *isn't* show/hide became unreachable because of
the one thing it can't do.

So the rack degrades along exactly that line: it stops mirroring and lists what
PRSH can **configure** — every element (one row per active board for a
`scope: 'board'` one), plus the producer's containers with their rostered members
nested under them exactly as they nest online, plus any fed element no roster
claims (top-level, because *being unreachable* is the problem its stage solves).

- **One section, `ELEMENTS`, no scenes** — there are none to group by. It is a
  selector rather than a monitor, which is the honest half of the rack's job when
  there is nothing to monitor.
- **Same placement shape as `sourcelessPlacement`** (`item: null`, `scene: null`,
  `where: 'none'`), because that is what these are: things we know the identity of
  and not the location. Everything downstream therefore works untouched —
  `chipFor` reads `—` with no new word in the vocabulary, the stage opens, and the
  fed radio still writes a feed (a state write needs no OBS).
- **No eye on a catalog row.** There is no scene item to show or hide, and a dead
  control is worse than an absent one.
- **Ids are the PRE-SCENE form** (`scoreboard:1`) — which is also exactly what a
  legacy pin looks like, so a selection or pin made offline resolves to the real
  scene copy the moment OBS opens. Read-time resolution again; nothing rewritten.
- **`connecting` is not offline.** Scenes are empty then too, and swapping to the
  catalog for a third of a second reads as a glitch. The rack says "Connecting…".
- This is the one legitimate reader left for the **declared** board list
  (`scoreboards.active`): with no OBS there is nothing to discover boards from,
  and Settings genuinely knows the rig.

**The three OBS-independent affordances, in the three places a producer looks:**

- The **source strip's Bind slot becomes Copy URL** (`absoluteOverlayUrl`, same
  builder Bind uses, host-qualified against the origin already serving the
  console). It used to read a flat "OBS offline" — a dead end in the one place the
  panel exists to act, and wrong about the situation: a producer whose OBS is on
  another machine, or who uses another app entirely, needs exactly that string.
- The **Add picker opens with no scene** (`open` is a prop separate from `scene`).
  Copy URL and **+ New** container are fully live; Add alone is disabled and says
  why, holding its place rather than vanishing (same rule as the Push slot).
  Gating the whole picker on a scene is what made the container builder
  unreachable for anyone whose OBS wasn't up.
- **Messages name the real reason.** "Isn't in any scene we can see" is true
  offline but useless, and both ways out it named (the header's Bind, a scene's +)
  exist only with a connection — so `BindingNote` and the rail's quick faces
  branch on `useConsoleOffline`.

Payoff beyond the producer: the console is now testable and browser-verifiable
without an OBS mirror, which is why phase 3's container surfaces went unverified.

## Which scenes the console can see — the mirror

`src/context/obs.jsx` mirrors OBS scene-by-scene, and **not every scene is
mirrored**. Program and the studio-preview scene are eager. Any other scene is
mirrored only once a surface asks, via `useMirrorScene(sceneName)` (hook) or the
`mirrorScene(name)` store action, and stays mirrored for the life of the
connection.

- **Read a scene's items through the hook, not `sceneItems[name]` directly.**
  The raw store entry is `undefined` both for "still loading" and for "nobody
  asked" — `useMirrorScene` returns `{ items, loading, mirrored }` so an empty
  section renders "no PRSH sources here" only when that is actually true.
- **A scene not in `mirroredScenes` gets no events.** `SceneItemCreated` /
  `Removed` / `ListReindexed` are gated on the tracked set, deliberately: an
  ungated handler pulls scenes nobody opened into the store. If a surface needs
  a scene live, it must mirror it.
- **Input settings are cached by source name**, so mirroring another scene
  costs one `GetSceneItemList` plus a call only for sources not seen before. The
  cache is invalidated by `InputSettingsChanged` (which also re-runs the
  shutdown reconciliation) and `InputRemoved`. Don't add a code path that reads
  a source's url by calling `GetInputSettings` directly — go through the cache
  or the mirror, or the fan-out this exists to prevent comes back.

