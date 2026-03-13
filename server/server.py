import asyncio
from pathlib import Path

from aiopath import AsyncPath
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from loguru import logger

from server.api import router_v1
from server.rio.game_pool import RioGamePool
from server.rio.provider import RioGameDataProvider
from server.settings import Settings, Config
from server.state import State
from server.tray import Tray
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
    consumer = asyncio.create_task(State.Consumer())
    await State.Load()
    await RioGameDataProvider.Start()
    await RioGamePool.Start()

    # wait for signal for shutdown
    yield

    # on_shutdown
    await RioGamePool.Stop()
    await RioGameDataProvider.Stop()
    consumer.cancel()

    shutdown_tasks = [
        asyncio.create_task(Settings.Save()),
        asyncio.create_task(State.SaveImmediately())
    ]
    if Tray.icon:
        shutdown_tasks.append(asyncio.create_task(asyncio.to_thread(Tray.icon.stop)))
    await asyncio.wait(shutdown_tasks, timeout=5.0)

app = FastAPI(lifespan=lifespan)

# In dev mode dist/ may not exist yet; fall back to public/ for the template
_template_dir = "./dist" if Path("./dist").is_dir() else "./public"
templates = Jinja2Templates(directory=_template_dir)

# react assets (/dist/assets) — only mount if built; in dev mode Vite serves these
if Path("./dist/assets").is_dir():
    app.mount("/assets", StaticFiles(directory="./dist/assets"), name="assets")

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
