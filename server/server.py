import asyncio
import aiofiles
import aiofiles.os
import aiofiles.ospath
import orjson

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from loguru import logger
from typing_extensions import Annotated
from webbrowser import open_new_tab

from server.api import router_v1
from server.settings import get_settings, save_settings, Settings, Config
from server.state import State
from server.tray import Tray

async def load_manifest() -> dict:
    settings = get_settings()
    css = []
    js = []

    if await aiofiles.ospath.exists("./dist/.vite/manifest.json") == True:
        manifest = {}
        if settings.server.dev == False:
            async with aiofiles.open("./dist/.vite/manifest.json", "rb") as file:
                manifest = await asyncio.to_thread(orjson.loads, await file.read())

        for name in manifest:
            js.append(manifest[name].file)
            if "css" in manifest[name]:
                for name in manifest[name].css:
                    css.append(name)

    return {"css": css, "js": js}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # on_startup
    settings = get_settings()

    if settings.server.dev == True:
        logger.info("For dev work, please use the server URL below instead of Vite's!")

    host = settings.server.host
    if host == "0.0.0.0":
        host = "127.0.0.1"

    if settings.server.autostart == True:
        await asyncio.to_thread(open_new_tab, f"http://{host}:{settings.server.port}")

    consumer = asyncio.create_task(State.Consumer())
    await State.Load()

    # wait for signal for shutdown
    yield

    # on_shutdown
    consumer.cancel()

    await asyncio.wait([
        asyncio.create_task(asyncio.to_thread(Tray.icon.stop)),
        asyncio.create_task(save_settings()),
        asyncio.create_task(State.SaveImmediately())
    ], timeout=5.0)

app = FastAPI(lifespan=lifespan)
templates = Jinja2Templates(directory="./dist")

# react assets (/dist/assets)
app.mount("/assets", StaticFiles(directory="./dist/assets"), name="assets")

# /api/v1/* | api_v1_*
app.include_router(router_v1)

# tsh_info.json
@app.get("/tsh_info.json", response_class=ORJSONResponse)
async def tsh_info() -> ORJSONResponse:
    return ORJSONResponse([Config.config])

# root (/index.html etc)
@app.get("/", response_class=HTMLResponse)
async def index(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)]
) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "name": Config.config["name"],
            "version": Config.config["version"],
            "settings": dict(settings),
            "manifest": await load_manifest()
        }
    )