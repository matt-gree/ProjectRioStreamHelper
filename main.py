import sys
import multiprocessing
import asyncio

from uvicorn import Config, Server
from socketio import ASGIApp
from loguru import logger
from webbrowser import open_new_tab

from server import server, socketio
from server.state import State
from server.settings import Settings, Config as TSHConfig
from server.tray import Tray
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
    tray = Tray.create_tray()

    try:
        task_serve = asyncio.create_task(uvi.serve(), name="uvicorn")
        task_tray = asyncio.create_task(asyncio.to_thread(tray.run), name="tray")

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

        logger.debug("awaiting server and tray")
        tasks, _ = await asyncio.wait([task_serve, task_tray])
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