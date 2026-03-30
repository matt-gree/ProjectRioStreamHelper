import asyncio
from pathlib import Path

from aiopath import AsyncPath
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from loguru import logger

from server.api import router_v1
from server.paths import user_data_dir, ensure_game_data
from server.rio.game_pool import OngoingGamePool, CompletedGamePool
from server.rio.rotation import RotationManager
from server.rio.provider import RioGameDataProvider
from server.settings import Settings, Config
from server.startgg.provider import StartGGProvider
from server.challonge.provider import ChallongeProvider
from server.state import State
from server.utils import json

async def load_manifest() -> dict:
    css = []
    js = []

    manifest_json = AsyncPath("./dist/.vite/manifest.json")
    if await manifest_json.exists() == True:
        manifest = {}
        if await Settings.Get("server.dev") == False:
            async with manifest_json.open(mode="rb", encoding="utf-8") as file:
                manifest = await json.loads(await file.read())

        for name in manifest:
            logger.debug("[manifest] adding js: {}", manifest[name]["file"])
            js.append(manifest[name]["file"])
            if "css" in manifest[name]:
                for css_file in manifest[name]["css"]:
                    logger.debug("[manifest] adding css: {}", css_file)
                    css.append(css_file)

    return {"css": css, "js": js}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # on_startup
    ensure_game_data()
    consumer = asyncio.create_task(State.Consumer())
    await State.Load()
    await RioGameDataProvider.Start()
    await OngoingGamePool.Start()
    await CompletedGamePool.Start()
    await RotationManager.Start()
    await StartGGProvider.Start()
    await ChallongeProvider.Start()

    # wait for signal for shutdown
    yield

    # on_shutdown
    await ChallongeProvider.Stop()
    await StartGGProvider.Stop()
    await RotationManager.Stop()
    await CompletedGamePool.Stop()
    await OngoingGamePool.Stop()
    await RioGameDataProvider.Stop()
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
    await asyncio.wait(shutdown_tasks, timeout=5.0)

app = FastAPI(lifespan=lifespan)

# In dev mode dist/ may not exist yet; fall back to public/ for the template
_template_dir = "./dist" if Path("./dist").is_dir() else "./public"
templates = Jinja2Templates(directory=_template_dir)

# react assets (/dist/assets) — only mount if built; in dev mode Vite serves these
if Path("./dist/assets").is_dir():
    app.mount("/assets", StaticFiles(directory="./dist/assets"), name="assets")

# game assets (character icons, team logos) — served from public/game_assets/
if Path("./public/game_assets").is_dir():
    app.mount("/game_assets", StaticFiles(directory="./public/game_assets"), name="game_assets")

# OBS browser source layouts — served from public/layout/
_layout_dir = Path("./public/layout")

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
                    "url": f"{base}/layout/{rel}",
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
    app.mount("/layout", StaticFiles(directory="./public/layout", html=True), name="layout")

# Tournament branding assets (logos) — served from user_data/branding/
_branding_dir = user_data_dir() / "branding"
_branding_dir.mkdir(parents=True, exist_ok=True)
app.mount("/branding", StaticFiles(directory=str(_branding_dir)), name="branding")

# Favicon
@app.get("/favicon.png")
async def favicon():
    return FileResponse("./public/favicon.png", media_type="image/png")

# /api/v1/* | api_v1_*
app.include_router(router_v1)

# root (/index.html etc)
@app.get("/", response_class=HTMLResponse)
async def index(
    request: Request
) -> HTMLResponse:
    # In dev mode, use the request's host so the page works from any device.
    vite_host = request.headers.get("host", "localhost").split(":")[0]
    vite_port = await Settings.Get("server.vite_port", 5173)

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
