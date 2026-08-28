---
name: controller-overlay
description: The optional gc-overlay controller-input overlay — macOS-only platform gating, submodule detection order, the build hook in PRSH.spec, and the per-side controller-port follow that makes a left/right browser source track whoever is on that side. Read before touching server/controller_overlay.py, server/api/v1/controller.py, public/layout/controller/, or the gc-overlay submodule wiring.
---

# Controller Overlay (gc-overlay)

`ControllerOverlay` (`server/controller_overlay.py`) manages an optional
subprocess that draws controller inputs as a separate OBS browser source.

## macOS-only — four gates, keep them in sync

gc-overlay reads controller state over AF_UNIX MemoryWatcher sockets, which is
why it is Darwin-only. The restriction is enforced in four places; if you touch
one, check the others:

1. `controller_overlay.PLATFORM_SUPPORTED` — the runtime gate.
2. `Config.controller_overlay_supported` — hides the UI off-Darwin.
3. `server/api/v1/layouts.py` — omits `controller/` from the layout catalog
   off-Darwin. **Platform-gate any test that asserts on the catalog**, or it
   fails on Linux CI.
4. `PRSH.spec` — bundles gc-overlay on Darwin only.

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

`scripts/build-gc-overlay.py`, invoked from `PRSH.spec`. Set
`SKIP_GC_OVERLAY_BUILD=1` to skip it during local PRSH builds.

gc-overlay owns its own version; update it with:

```bash
git submodule update --remote gc-overlay
```

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

`controller` is a registered Production element; off-Darwin the layouts catalog
omits it, so the Add picker never offers it and no rack row derives, and the
Connections card hides on `Config.controller_overlay_supported`.

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
