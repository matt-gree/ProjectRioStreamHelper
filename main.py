import sys
import multiprocessing
import asyncio

from uvicorn import Config, Server
from socketio import ASGIApp
from loguru import logger

from server import server
from server.settings import Settings
from server.utils.uvilogger import setup_logger

async def main() -> int:
    logger.add(
        "./logs/tsh_info.txt",
        format="[{time:YYYY-MM-DD HH:mm:ss}] - {level} - {file}:{function}:{line} | {message}",
        encoding="utf-8",
        level="INFO",
        rotation="20 MB"
    )

    logger.add(
        "./logs/tsh_error.txt",
        format="[{time:YYYY-MM-DD HH:mm:ss}] - {level} - {file}:{function}:{line} | {message}",
        encoding="utf-8",
        level="ERROR",
        rotation="20 MB"
    )

    await Settings.Load()

    uvi = Server(Config(
        app=ASGIApp(
            server.app.socketio,
            other_asgi_app=server.app
        ),
        host=await Settings.Get("server.host","127.0.0.1"),
        port=await Settings.Get("server.port",5260),
        reload=await Settings.Get("dev", False),
        loop=asyncio.get_event_loop()
    ))

    setup_logger()
    await uvi.serve()

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