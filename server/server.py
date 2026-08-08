import asyncio
from pathlib import Path

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from loguru import logger

from server.api import router_v1
from server.utils.tasks import spawn, drain
from server.api.v1.assets import get_msb_assets_path
from server.api.v1.layouts import layout_url
from server.paths import app_root, user_data_dir, ensure_game_data, rio_visualizer_dir
from server.rio.game_pool import OngoingGamePool, CompletedGamePool
from server.rio.rotation import PoolManager
from server.rio.provider import RioGameDataProvider
from server.rio import stats_api
from server.settings import Settings, Config
from server.startgg.provider import StartGGProvider
from server.controller_overlay import ControllerOverlay
from server.announcements import Announcements
from server.automations import Automations
from server.participants import Participants
from server.match import Match
from server.commentary import Commentary
from server.playerplates import PlayerPlates
from server.state import State
from server.utils import json

async def load_manifest() -> dict:
    css: list[str] = []
    js: list[str] = []

    if Settings.Get("server.dev") is True:
        return {"css": css, "js": js}

    # PyInstaller on Windows drops files inside hidden (dot-prefixed) dirs,
    # so the spec also stages a copy at dist/vite_manifest.json. Prefer the
    # Vite-native path in dev, fall back to the staged copy in frozen builds.
    candidates = [app_root() / "dist/.vite/manifest.json", app_root() / "dist/vite_manifest.json"]
    manifest_json = next((p for p in candidates if p.is_file()), None)
    if manifest_json is None:
        logger.warning(
            "[manifest] not found; tried {} (cwd={})",
            [str(p) for p in candidates],
            Path.cwd(),
        )
        return {"css": css, "js": js}

    try:
        data = manifest_json.read_bytes()
        manifest = await json.loads(data)
    except Exception as exc:
        logger.exception("[manifest] failed to parse {}: {}", manifest_json, exc)
        return {"css": css, "js": js}

    for name, entry in manifest.items():
        if "file" in entry:
            logger.debug("[manifest] adding js: {}", entry["file"])
            js.append(entry["file"])
        for css_file in entry.get("css", []):
            logger.debug("[manifest] adding css: {}", css_file)
            css.append(css_file)

    logger.info("[manifest] loaded {} js / {} css entries", len(js), len(css))
    return {"css": css, "js": js}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # on_startup
    ensure_game_data()
    consumer = asyncio.create_task(State.Consumer())
    await State.Load()
    # Load the participant registry back into memory before anything that reads
    # it (resurface, Match projection). Without this the address book starts
    # empty every launch even though it persisted to participants.json.
    await Participants.Load()
    await RioGameDataProvider.Start()
    # Warm the Rio caches once per launch rather than trusting a cache.pkl
    # timestamp that can be a day stale. Fire-and-forget so a slow/offline Rio
    # API doesn't delay startup; the manual Settings refresh covers mid-session.
    # prime_caches orders the two halves — the mode list now (a HUD frame waits
    # on it), the completer-cache rebuild a minute in (it starves the loop).
    spawn(stats_api.prime_caches(), name="stats.prime_caches")
    await OngoingGamePool.Start()
    await CompletedGamePool.Start()
    await PoolManager.Start()
    await StartGGProvider.Start()
    await ControllerOverlay.Start()
    await Announcements.Start()
    # Re-apply every persisted match onto its bound board(s) (resume-on-startup
    # spirit). Runs after State + registry are loaded.
    await Match.project_all()
    # Re-resolve the persisted commentary desk against the current registry so a
    # renamed/edited caster reflows on launch (resolve-by-copy, like Match).
    await Commentary.project_all()
    # Same for the player-plates band — re-resolve its config against the current
    # registry/matches so a match-fed plate reflects the latest names on launch.
    await PlayerPlates.project_all()

    # Container automations. Registers the state write hooks (so a rule decides
    # in the same batch as its trigger) and settles every container: a producer's
    # suspension is restored from the mirrored reason, anything else returns to
    # its resting occupant. Last, so State + Settings are loaded and the boot
    # projections have already landed.
    await Automations.Start()

    # If stream labels are enabled but the output dir is missing, do a full
    # export so OBS Text (GDI+) sources don't point at missing files.
    if await State._is_export_enabled():
        import os
        if not os.path.isdir(str(State._labels_dir())):
            await State.ExportAll()

    # wait for signal for shutdown
    yield

    # on_shutdown
    await Automations.Stop()
    await Announcements.Stop()
    await ControllerOverlay.Stop()
    await StartGGProvider.Stop()
    await PoolManager.Stop()
    await CompletedGamePool.Stop()
    await OngoingGamePool.Stop()
    await RioGameDataProvider.Stop()
    # Background work spawned during the run — a stats refresh, a game-end
    # resolver mid-retry — gets a bounded chance to finish before the state
    # queue closes under it, then is cancelled.
    await drain(timeout=3.0)
    consumer.cancel()

    shutdown_tasks = [
        asyncio.create_task(Settings.Save()),
        asyncio.create_task(State.SaveImmediately())
    ]
    try:
        from server.tray import Tray
        if Tray.icon:
            shutdown_tasks.append(asyncio.create_task(asyncio.to_thread(Tray.icon.stop)))
    except Exception:
        pass
    # gather (not wait) so a failed save is logged instead of silently
    # swallowed; the timeout still bounds a hung save at shutdown.
    try:
        await asyncio.wait_for(
            asyncio.gather(*shutdown_tasks, return_exceptions=True), timeout=5.0
        )
    except asyncio.TimeoutError:
        logger.warning("shutdown tasks did not finish within 5s — exiting anyway")
    else:
        for task in shutdown_tasks:
            exc = task.exception()
            if exc is not None:
                logger.error("shutdown task failed: {!r}", exc)

app = FastAPI(lifespan=lifespan)


@app.exception_handler(HTTPException)
async def _http_exception_handler(_request: Request, exc: HTTPException) -> ORJSONResponse:
    """Render HTTPException as {"error": detail} so the wire shape is uniform."""
    return ORJSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(_request: Request, exc: Exception) -> ORJSONResponse:
    """Catch-all: log the real error, return a generic 500 without leaking internals."""
    logger.exception("unhandled exception in request handler: {}", exc)
    return ORJSONResponse({"error": "Internal server error"}, status_code=500)

# Static app assets resolve against the repo root / frozen bundle root
# (app_root), never the CWD, so `python main.py` works from any directory.
_dist_dir = app_root() / "dist"
_public_dir = app_root() / "public"

# In dev mode dist/ may not exist yet; fall back to public/ for the template
_template_dir = str(_dist_dir) if _dist_dir.is_dir() else str(_public_dir)
templates = Jinja2Templates(directory=_template_dir)

# react assets (/dist/assets) — only mount if built; in dev mode Vite serves these
if (_dist_dir / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(_dist_dir / "assets")), name="assets")

# MSB assets — user-supplied (Nintendo IP, not bundled). Served from a
# user-configurable path (Settings → Project Rio → MSB Image Assets) with
# a writable default under user_data/. Registered as a route handler
# (not a static mount) so the path resolves per-request from settings,
# and registered BEFORE the broader /game_assets mount so it wins.
@app.get("/game_assets/msb/{file_path:path}")
async def msb_asset(file_path: str):
    base = await get_msb_assets_path()
    requested = (base / file_path).resolve()
    try:
        requested.relative_to(base.resolve())  # path-traversal guard
    except ValueError:
        return HTMLResponse("Forbidden", status_code=403)
    if requested.is_file():
        return FileResponse(str(requested))
    # Dev fallback: assets dropped into the repo's public/game_assets/msb/.
    # This route is registered before the /game_assets static mount and would
    # otherwise shadow it for every /msb/* path, so resolve it here. No-op in
    # frozen builds (no public/ dir) where everything lives in user_data.
    fallback_base = (_public_dir / "game_assets/msb").resolve()
    fallback = (fallback_base / file_path).resolve()
    try:
        fallback.relative_to(fallback_base)  # path-traversal guard
    except ValueError:
        return HTMLResponse("Forbidden", status_code=403)
    if fallback.is_file():
        return FileResponse(str(fallback))
    return HTMLResponse("Not Found", status_code=404)

# game assets (non-MSB) — served from public/game_assets/
if (_public_dir / "game_assets").is_dir():
    app.mount("/game_assets", StaticFiles(directory=str(_public_dir / "game_assets")), name="game_assets")

# OBS browser source layouts — served from public/layout/
_layout_dir = _public_dir / "layout"

@app.get("/layout", response_class=HTMLResponse)
@app.get("/layout/", response_class=HTMLResponse)
async def layout_index(request: Request) -> HTMLResponse:
    """Browse available OBS layout files."""
    host = request.headers.get("host", "localhost:5260")
    base = f"http://{host}"
    layouts: list[dict] = []

    if _layout_dir.is_dir():
        for group in sorted(_layout_dir.iterdir()):
            if not group.is_dir():
                continue
            files = sorted(f for f in group.iterdir() if f.suffix == ".html")
            for f in files:
                rel = f.relative_to(_layout_dir)
                layouts.append({
                    "group": group.name,
                    "name": f.stem,
                    # as_posix: a Path renders with the native separator, which
                    # would put a backslash in this URL on Windows.
                    "url": layout_url(base, rel),
                })

    rows = ""
    for l in layouts:
        rows += (
            f'<tr>'
            f'<td>{l["group"]}</td>'
            f'<td><a href="{l["url"]}" target="_blank">{l["name"]}</a></td>'
            f'<td><input type="text" value="{l["url"]}" readonly '
            f'onclick="this.select();document.execCommand(\'copy\')" '
            f'style="width:100%;border:1px solid #ccc;padding:4px;cursor:pointer" '
            f'title="Click to copy"/></td>'
            f'</tr>'
        )

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>OBS Layouts</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }}
  h1 {{ margin-bottom: 4px; }}
  p {{ color: #666; margin-top: 0; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th, td {{ text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }}
  th {{ background: #f5f5f5; }}
  a {{ color: #0066cc; }}
</style></head>
<body>
  <h1>OBS Browser Source Layouts</h1>
  <p>Click a URL field to copy it, then paste into OBS as a Browser Source.</p>
  <table>
    <tr><th>Group</th><th>Layout</th><th>URL (click to copy)</th></tr>
    {rows}
  </table>
  {('<p style="color:#999">No layouts found in <code>public/layout/</code></p>' if not layouts else '')}
</body></html>"""
    return HTMLResponse(html)

if _layout_dir.is_dir():
    app.mount("/layout", StaticFiles(directory=str(_layout_dir), html=True), name="layout")

# RioVisualizer shared web assets (renderer.js core + themes) — served straight
# from the submodule so the hit overlay and the standalone debug tool share one
# source of truth. (Frozen builds bundle this dir; that's wired in PRSH.spec.)
_rio_viz_web = rio_visualizer_dir() / "web"
if _rio_viz_web.is_dir():
    app.mount("/rio-visualizer", StaticFiles(directory=str(_rio_viz_web)), name="rio_visualizer")

# Tournament branding assets (logos) — served from user_data/branding/
_branding_dir = user_data_dir() / "branding"
_branding_dir.mkdir(parents=True, exist_ok=True)
app.mount("/branding", StaticFiles(directory=str(_branding_dir)), name="branding")

# Design-package assets (element theme SVGs). A dynamic route rather than a
# static mount because each request resolves across two roots: the built-in
# packages in ./public/design/ and user-installed ones in
# user_data/design_packages/. Validation lives in design_packages.resolve_asset.
from server.design_packages import resolve_asset as _resolve_design_asset  # noqa: E402


@app.get("/design/{package_id}/{filename}")
async def design_asset(package_id: str, filename: str):
    path = _resolve_design_asset(package_id, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="No such design asset")
    return FileResponse(path)

# Favicon
@app.get("/favicon.png")
async def favicon():
    return FileResponse(str(_public_dir / "favicon.png"), media_type="image/png")

# /api/v1/* | api_v1_*
app.include_router(router_v1)

# root (/index.html etc)
@app.get("/", response_class=HTMLResponse)
async def index(
    request: Request
) -> HTMLResponse:
    # In dev mode, use the request's host so the page works from any device.
    vite_host = request.headers.get("host", "localhost").split(":")[0]
    vite_port = Settings.Get("server.vite_port", 5173)

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "name": Config.config["name"],
            "version": Config.config["version"],
            "settings": Settings.settings,
            "manifest": await load_manifest(),
            "vite_host": vite_host,
            "vite_port": vite_port,
        }
    )
