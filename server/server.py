import asyncio
import aiofiles
import aiofiles.os
import aiofiles.ospath
import orjson

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from socketio import AsyncServer
from loguru import logger

from server.settings import Settings, Config
from server.api import router_v1

async def on_startup(app: FastAPI):
    await Config.Load()

    if await Settings.Get("server.dev") == True:
        logger.info("For dev work, please use the server URL below instead of Vite's!")

async def on_shutdown(app: FastAPI):
    await Settings.Save()

async def load_manifest() -> dict:
    css = []
    js = []

    if await aiofiles.ospath.exists("./dist/.vite/manifest.json") == True:
        manifest = {}
        if await Settings.Get("server.dev") == False:
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
    await on_startup(app)
    yield
    await on_shutdown(app)

app = FastAPI(lifespan=lifespan)
app.socketio = AsyncServer(async_mode="asgi")
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
async def index(request: Request) -> HTMLResponse:
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