import sys
import os
import multiprocessing
import asyncio

from uvicorn import Config, Server
from socketio import ASGIApp
from loguru import logger
from webbrowser import open_new_tab

from server import server, socketio
from server.state import State
from server.settings import Settings, Config as TSHConfig
from server.utils.uvilogger import setup_logger

async def main() -> int:
    logger.add(
        "./logs/tsh_info.txt",
        format="[{time:YYYY-MM-DD HH:mm:ss}] - {level} - {file}:{function}:{line} | {message} | {extra}",
        encoding="utf-8",
        level="INFO",
        rotation="20 MB",
        enqueue=False
    )

    logger.add(
        "./logs/tsh_error.txt",
        format="[{time:YYYY-MM-DD HH:mm:ss}] - {level} - {file}:{function}:{line} | {message} | {extra}",
        encoding="utf-8",
        level="ERROR",
        rotation="20 MB",
        enqueue=False
    )

    await asyncio.wait([
        asyncio.create_task(TSHConfig.Load()),
        asyncio.create_task(Settings.Load())
    ])

    # TSH_DEV=1 is set by `npm run server` (via package.json).
    # Running python3 main.py directly uses production mode.
    dev_mode = os.environ.get("TSH_DEV") == "1"
    await Settings.Set("server.dev", dev_mode)

    host = await Settings.Get("server.host", "0.0.0.0")
    port = await Settings.Get("server.port", 5260)
    autostart = await Settings.Get("server.autostart", True)

    uvi = Server(Config(
        app=ASGIApp(
            socketio,
            other_asgi_app=server.app
        ),
        host=host,
        port=port,
        reload=await Settings.Get("dev", False),
        loop=asyncio.get_event_loop()
    ))

    setup_logger()

    try:
        task_serve = asyncio.create_task(uvi.serve(), name="uvicorn")

        while not uvi.started:
            await asyncio.sleep(0.1)

        for uvi_server in uvi.servers:
            for socket in uvi_server.sockets:
                host_port = socket.getsockname()
                host = host_port[0]
                port = host_port[1]

        if host == "0.0.0.0":
            host = "localhost"

        server_url = f"http://{host}:{port}/"
        await TSHConfig.SetServerURL(server_url)

        if autostart:
            logger.debug("opening browser to {server_url}", server_url=server_url)
            await asyncio.to_thread(open_new_tab, server_url)

        logger.debug("awaiting server")
        tasks, _ = await asyncio.wait([task_serve])
        for task in tasks:
            if task.exception():
                raise task.exception()

    except (asyncio.exceptions.CancelledError, KeyboardInterrupt):
        pass

    return 0

if __name__ == '__main__':
    # Pyinstaller fix
    multiprocessing.freeze_support()

    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        sys.stderr = open('./logs/tsh_error.txt', 'w', encoding='utf-8')
        sys.stdout = open('./logs/tsh_info.txt', 'w', encoding='utf-8')

    ret = 0
    try:
        ret = asyncio.run(main())
    except (asyncio.exceptions.CancelledError, KeyboardInterrupt):
        pass
    except:
        logger.exception("Exiting application due to exception")
        sys.exit(1)
    finally:
        sys.exit(ret)
