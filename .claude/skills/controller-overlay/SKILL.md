---
name: controller-overlay
description: The optional gc-overlay controller-input overlay — its two peer Dolphin transports and why there is no longer a platform gate, submodule detection order, the build hook in PRSH.spec, and the per-side controller-port follow that makes a left/right browser source track whoever is on that side. Read before touching server/controller_overlay.py, server/api/v1/controller.py, public/layout/controller/, or the gc-overlay submodule wiring.
---

# Controller Overlay (gc-overlay)

`ControllerOverlay` (`server/controller_overlay.py`) manages an optional
subprocess that draws controller inputs as a separate OBS browser source.

## No platform gate — presence is the only condition

**There used to be four gates and there are now none** (removed 2026-08-28):
`PLATFORM_SUPPORTED`, `Config.controller_overlay_supported`, the layouts-catalog
omission, and the `PRSH.spec` build condition. Don't reintroduce one.

gc-overlay 1.1.0 carries **two peer Dolphin transports**, and which is available
is a property of the platform — but between them they cover every platform PRSH
runs on:

| Transport | How | macOS | Windows | Linux |
|---|---|:-:|:-:|:-:|
| `memorywatcher` | Dolphin pushes changes over an AF_UNIX socket | ✅ | ❌ | ✅ |
| `dme` | We poll the Dolphin process's memory, as M'Overlay does | ❌ | ✅ | ✅ |

**The constraint is inverted between them**, which is why neither is a fallback.
MemoryWatcher cannot exist on Windows — Dolphin guards `MemoryWatcher.cpp` with
`if(UNIX)` (and `USE_MEMORYWATCHER` at every call site), and the class is
`AF_UNIX` + `SOCK_DGRAM`, a socket type Windows' AF_UNIX does not support at
all, so this is not a build flag. Process-memory reads cannot work on macOS,
where Rio ships a hardened runtime with no `get-task-allow` entitlement — which
is the reason the MemoryWatcher path was written in the first place.
gc-overlay's own `main.resolve_transport` picks; PRSH passes only `--port`.

**What actually gates the feature is whether gc-overlay is FOUND** —
`_find_gc_overlay()` answering `None`, surfaced as `available` in
`GetStatus()`, which the Connections card already renders as "Not found" with
a manual path input. "Supported" was standing in for "present," and on the one
platform whose transport most needed real-world testing it hid the feature from
the machine that could do the testing. `GetStatus()` still reports
`"supported": True` for API compatibility with an older frontend build.

## Detection order

Bundled via the `gc-overlay/` git submodule. The resolver tries, in order:

1. Frozen nested binary (inside the `.app` bundle)
2. In-repo submodule (`gc-overlay/`)
3. Sibling checkout (`../gc-overlay/`)

A custom path override (set on the Connections tab) wins over all three.

**Frozen builds** run the standalone binary — PRSH re-`chmod +x`'s it, because
the executable bit does not survive every packaging path. **Source checkouts**
run `python main.py` inside gc-overlay's *own* venv, not PRSH's.

## Build

`scripts/build-gc-overlay.py`, invoked from `PRSH.spec` on every platform. Set
`SKIP_GC_OVERLAY_BUILD=1` to skip it during local PRSH builds.

gc-overlay owns its own version; update it with:

```bash
git submodule update --remote gc-overlay
```

## The URL is the whole integration — and it is silent when wrong

PRSH and gc-overlay are two programs on two ports, and everything PRSH asks of
the reader it asks in a query string. Nothing fails, logs, or previews
differently when a param is dropped; it just goes out on air wrong. So the
broadcast string lives in ONE constant, `GC_CHROME` in `lib/controller-mount.js`,
and is pinned by `src/routes/layouts/controller-mount.test.js`.

| Param | Broadcast source | Connections preview | Why |
|---|---|---|---|
| `port` | `hudPort + 1` | `1`–`4` literal | The off-by-one above |
| `bg` | `transparent` | `transparent` | Else an opaque `#1a1a2e` box in OBS |
| `gear` | `0` | `0` | Its first control switches port, contradicting the caption |
| `portlabel` | `0` | `0` | PRSH captions the side / the port itself |
| `status` | `0` | **on** | "Waiting for controller data..." is chrome on air and the *point* of a diagnostic |
| `labels` · `keyline` · `idlefill` | producer's | producer's (global only) | Appearance — see below |

**Static params, never `POST /api/settings`.** gc-overlay also exposes a settings
API, but it moves the reader's *server-wide* defaults and pushes to every
connected client. Two sides are two browser sources on one reader, so anything
app-wide has them fighting over one knob — and a per-element override could not
exist at all. Per-source URL params are the model that matches PRSH's.

## Appearance: `overlays.controller.*`, one layer

Three of gc-overlay's settings are the producer's, and they live where every
other element's look lives — `overlays.controller.{key}`, authored on the
element's Production stage panel.

| Setting | gc-overlay param | Settings key | Default |
|---|---|---|---|
| Letters | `labels` | `labels` (bool) | `true` |
| Keyline | `keyline` | `keyline` (bool) | `true` |
| Idle fill | `idlefill` | `idleFillOpacity` (0–1) | `0` |

Defaults are gc-overlay's own, so an untouched element draws exactly what the
reader draws standalone.

**There was briefly a second layer and it should not come back.** An app-wide
copy lived on the Connections tab (`controller_overlay.display.*`) with these as
three-state pins over it. A pin beats a global, so the moment a producer touched
one element the app-wide control stopped reaching it — invisibly, from a tab
that could not show why. And `overlays.controller.*` is shared by both `?team=`
sources already (they are one element), so a single layer is app-wide for every
controller source anyway. `Settings.Load` drops the old block.

**The opacity's control is a SLIDER (`FractionRow`), not a number field**, and
that is a correctness fix rather than a nicety. Asked for a 0–1 opacity in a
number box, a producer reads "Idle Fill Opacity" and types `10` meaning ten
percent — off the scale by a factor of a hundred, and it drew as fully solid. A
slider cannot express an out-of-range value (the range *is* the scale) and its
percent readout removes the ambiguity that invited one. It is stored in
gc-overlay's own 0–1 **end to end**; the percentage is applied and undone inside
the control that shows it, so nothing in between has a second unit to get wrong.
`displayParams` clamps anyway: gc-overlay *rejects* an out-of-range opacity, and
a rejected key on a query string is skipped, so a bad value would silently draw
the reader's default.

Adding a fourth appearance setting is three rows: `DISPLAY_KEYS`
(`lib/controller-mount.js`), `LAYOUT_SETTINGS.controller`, and the
`<meta name="overlay-settings">` whitelist.

**The Connections previews carry no style.** They iframe the reader at its own
look (chrome off, status text on) because they answer "is the pad reaching
PRSH" — and the most legible drawing is the right one for that. A keyline
switched off for bright gameplay is a worse diagnostic, and a preview that needs
the style to be right before it can tell you the reader is wrong has two jobs.

## Native size: 512×180, and it lives in four PRSH runtimes

gc-overlay 1.2.0 redrew the overlay at **512×180** (was 512×256). Its page is one
SVG with `preserveAspectRatio="xMidYMid meet"`, so 512×180 is a *ratio* — any
size at 128:45 works and anything else letterboxes rather than distorting.

That number is written down in four places, and a miss is dead space in every
scene rather than an error:

1. `public/layout/controller/controller.html` — `body { width/height }` (which
   the layouts API reads back as the catalog's size hint)
2. `public/layout/lib/container-members.js` — `size: [512, 180]`, the container slot
3. `src/routes/production/elements.js` — what `addBrowserSource` gives OBS
4. `src/routes/connections/controller.jsx` — `nativeWidth`/`nativeHeight` on the previews

**An OBS source added before the resize keeps its old 512×256 box** and draws
the controller letterboxed inside it. Nothing breaks; the producer resizes it.

## Runtime + settings

Runs on its own port (default **8069**), separate from PRSH's 5260.
Settings live under `controller_overlay.{path,port,auto_start}`.

**The lifecycle lives on the CONNECTIONS tab, not on the element's stage panel**
(`src/routes/connections/controller.jsx`): path, port, auto-start, Start/Stop,
version, and the live per-port previews, over
`/api/v1/controller/{status,start,stop,path,port}`. It moved because Start/Stop
on the stage body could only be reached once an OBS source for the element
existed — you built a source for a reader that wasn't running in order to reach
the button that runs it.

The element's stage body (`src/routes/production/stage/controller.jsx`) keeps
only what is about the BROADCAST: the two per-side follow URLs, plus a read-only
status line linking to Connections. **Don't add a second Start there** — one
owner for the lifecycle is the whole point of the split.

`controller` is a registered Production element, offered by the Add picker on
every platform. If gc-overlay isn't installed the source simply draws its
"no reader" blank and the Connections card says so.

**There was a `controller_overlay.controller` setting and a
`PUT /controller/player` endpoint** — "which controller port to display",
app-wide. Per-side follow made both meaningless (the layout picks the port per
side) and nothing ever read the setting; both were deleted 2026-08-28. The
subprocess is launched with `--port` only.

### The previews, and the off-by-one they exist to catch

The Connections card iframes gc-overlay directly at `?port=1..4&bg=transparent`,
so they need no game, no HUD frame and no PRSH layout — press a button on a pad
and the right box moves. Each is labelled with the side currently holding that
port (`score.1.player.{T}.port`).

**gc-overlay's `?port=` is 1-INDEXED; the HUD's is 0-indexed.** Every crossing of
that boundary is silent when wrong: untranslated, port 0 worked by accident and
every other side drew the WRONG player's controller. `lib/controller-mount.js`
translates (`port + 1`); the previews speak gc-overlay's convention already.
`bg=transparent` is not optional either — gc-overlay paints an opaque `#1a1a2e`
unless asked, which lands in OBS as a solid dark box.

The mount names its three blanks via `OverlayBase.setBlank` (no reader / no port
on this side / no game), because on a transparent source they look identical —
pinned by `stage/blank-reason.test.jsx`.

## Per-side follow (the part that surprises people)

The HUD reports each player's controller port, which PRSH writes to
`score.{N}.player.{T}.port`. `public/layout/controller/controller.html`
(`?team=1|2`) then iframes gc-overlay **at that port** — so a left or right
browser source automatically follows whoever is sitting on that side, even when
Project Rio reassigns away/home between games.

This means the controller layout's `?team=` variant is bound to the PRSH side
cascade, not to a fixed controller index. If sides swap, the overlay follows.
