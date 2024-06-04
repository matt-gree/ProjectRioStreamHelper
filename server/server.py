import aiofiles
import aiofiles.os
import aiofiles.ospath
import tomllib

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from socketio import AsyncServer
from loguru import logger

from server import settings
from server.api import router_v1

program_context = {
    "name": "TournamentStreamHelper",
    "version": "?",
    "description": "",
    "authors": []
}

async def on_startup(app: FastAPI):
    global program_context

    logger.debug("starting...")
    async with aiofiles.open('pyproject.toml', mode='r', encoding='utf-8') as f:
        # pyproject.toml likely included in production builds as it makes
        # updating the version easier, less redundant, etc.
        program_context = tomllib.loads(await f.read())["tool"]["poetry"]

async def on_shutdown(app: FastAPI):
    logger.debug("shutting down...")
    await settings.save()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await on_startup(app)
    yield
    await on_shutdown(app)

app = FastAPI(lifespan=lifespan)
app.socketio = AsyncServer(async_mode='asgi')
templates = Jinja2Templates(directory='./dist')

# react assets (/dist/assets)
app.mount("/assets", StaticFiles(directory="./dist/assets"), name="assets")

# /api/v1/* | api_v1_*
app.include_router(router_v1)

# tsh_info.json
@app.get("/tsh_info.json", response_class=ORJSONResponse)
async def tsh_info() -> ORJSONResponse:
    return ORJSONResponse([program_context])

# root (/index.html etc)
@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context=program_context
    )