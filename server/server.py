import asyncio
import aiofiles
import aiofiles.os
import aiofiles.ospath

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from loguru import logger

from server.api import router_v1
from server.settings import Settings, Config
from server.state import State
from server.tray import Tray
from server.utils import json

async def load_manifest() -> dict:
    css = []
    js = []

    if await aiofiles.ospath.exists("./dist/.vite/manifest.json") == True:
        manifest = {}
        if await Settings.Get("server.dev") == False:
            async with aiofiles.open("./dist/.vite/manifest.json", "rb") as file:
                manifest = await json.loads(await file.read())

        for name in manifest:
            logger.debug("[manifest] adding js: {}", manifest[name].file)
            js.append(manifest[name].file)
            if "css" in manifest[name]:
                for name in manifest[name].css:
                    logger.debug("[manifest] adding css: {}", name)
                    css.append(name)

    return {"css": css, "js": js}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # on_startup
    consumer = asyncio.create_task(State.Consumer())
    await State.Load()

    # wait for signal for shutdown
    yield

    # on_shutdown
    consumer.cancel()

    await asyncio.wait([
        asyncio.create_task(asyncio.to_thread(Tray.icon.stop)),
        asyncio.create_task(Settings.Save()),
        asyncio.create_task(State.SaveImmediately())
    ], timeout=5.0)

app = FastAPI(lifespan=lifespan)
templates = Jinja2Templates(directory="./dist")

# react assets (/dist/assets)
app.mount("/assets", StaticFiles(directory="./dist/assets"), name="assets")

# /api/v1/* | api_v1_*
app.include_router(router_v1)

# root (/index.html etc)
@app.get("/", response_class=HTMLResponse)
async def index(
    request: Request
) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "name": Config.config["name"],
            "version": Config.config["version"],
            "settings": Settings.settings,
            "manifest": await load_manifest()
        }
    )