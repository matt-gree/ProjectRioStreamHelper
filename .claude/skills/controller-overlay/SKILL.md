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

A custom path override in Settings wins over all three.

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
Settings live under `controller_overlay.{path,port,controller,auto_start}`.

Start/stop and the source URLs are the **Controller element's stage body** in
the Production console (`src/routes/production/stage/controller.jsx`) — it hits
`/api/v1/controller/{status,start,stop,port}`. `controller` is a registered
Production element; off-Darwin the layouts catalog omits it, so the Add picker
never offers it and no rack row derives.

## Per-side follow (the part that surprises people)

The HUD reports each player's controller port, which PRSH writes to
`score.{N}.player.{T}.port`. `public/layout/controller/controller.html`
(`?team=1|2`) then iframes gc-overlay **at that port** — so a left or right
browser source automatically follows whoever is sitting on that side, even when
Project Rio reassigns away/home between games.

This means the controller layout's `?team=` variant is bound to the PRSH side
cascade, not to a fixed controller index. If sides swap, the overlay follows.
