# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for ProjectRioStreamHelper.

Build:
    macOS:   pyinstaller PRSH.spec
    Windows: pyinstaller PRSH.spec

Prerequisites:
    1. npm install && npm run build   (creates dist/)
    2. pip install pyinstaller
    3. git submodule update --init --recursive
"""
import os
import platform
import shutil
from pathlib import Path

block_cipher = None

# PyInstaller on Windows silently drops files inside hidden (dot-prefixed)
# directories, which strips dist/.vite/manifest.json from the bundle and
# leaves the frontend with no <script> tags. Stage a copy at a non-hidden
# path and bundle that instead.
_vite_src = Path('dist/.vite/manifest.json')
_vite_staged = Path('dist/vite_manifest.json')
if _vite_src.is_file():
    shutil.copy2(_vite_src, _vite_staged)

# Platform-specific separator for --add-data paths
SEP = ';' if platform.system() == 'Windows' else ':'

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Frontend build output
        ('dist/assets', 'dist/assets'),
        ('dist/game_assets', 'dist/game_assets'),
        ('dist/layout', 'dist/layout'),
        ('dist/favicon.png', 'dist'),
        ('dist/.vite/manifest.json', 'dist/.vite'),
        *([('dist/vite_manifest.json', 'dist')] if _vite_staged.is_file() else []),
        ('dist/index.html', 'dist'),

        # Public directory (game assets, layouts, favicon, tray logo)
        ('public/game_assets', 'public/game_assets'),
        ('public/layout', 'public/layout'),
        ('public/favicon.png', 'public'),
        ('public/logo.png', 'public'),
        ('public/logo.ico', 'public'),
        ('public/logo.icns', 'public'),
        ('public/logo_tray.png', 'public'),
        ('public/logo_tray.icns', 'public'),

        # pyrio submodule data
        ('server/rio/pyrio/CharNames.csv', 'server/rio/pyrio'),

        # Default user_data game config (only if directory exists)
        *([('user_data/games', 'user_data/games')] if os.path.isdir('user_data/games') else []),
    ],
    hiddenimports=[
        # FastAPI + ASGI
        'fastapi',
        'fastapi.staticfiles',
        'fastapi.templating',
        'fastapi.responses',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',

        # SocketIO
        'socketio',
        'engineio',

        # Core deps
        'loguru',
        'orjson',
        'watchfiles',
        'httpx',
        'aiopath',
        'pillow',
        'PIL',
        'pystray',
        'pystray._darwin',   # macOS tray backend
        'pystray._win32',    # Windows tray backend
        'cryptography',

        # Data science (required by pyrio)
        'pandas',
        'numpy',

        # Server modules
        'server',
        'server.server',
        'server.state',
        'server.settings',
        'server.tray',
        'server.rio',
        'server.rio.provider',
        'server.rio.hud_watcher',
        'server.rio.stats_tracker',
        'server.rio.stats_api',
        'server.rio.game_pool',
        'server.rio.rotation',
        'server.rio.pyrio',
        'server.api',
        'server.paths',
        'server.utils',
        'server.utils.json',
        'server.utils.deep_dict',
        'server.win_window',
        'server.announcements',
        'server.api.v1.announcements',
        'server.api.v1.logs',
        'server.port_conflict',

        # Jinja2 (used by FastAPI templates)
        'jinja2',

        # Multipart (FastAPI dependency)
        'multipart',
        'python_multipart',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['hooks/runtime_hook_chdir.py'],
    excludes=[
        # Exclude dev-only packages to reduce size
        'matplotlib',
        'scipy',
        'pytest',
        'setuptools',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

_exe_icon = 'public/logo.ico' if platform.system() == 'Windows' else 'public/logo.icns'

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='PRSH',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # No console window — app opens browser
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=os.environ.get('PYINSTALLER_TARGET_ARCH', None),
    codesign_identity=None,
    entitlements_file=None,
    icon=_exe_icon,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='PRSH',
    contents_directory='.',  # PyInstaller 6.x: keep all files next to executable
                              # (disables _internal/ subdir so ./dist ./public paths work)
)

# macOS .app bundle (only used when building on macOS)
if platform.system() == 'Darwin':
    app = BUNDLE(
        coll,
        name='PRSH.app',
        icon='public/logo.icns',
        bundle_identifier='com.projectrio.streamhelper',
        info_plist={
            'CFBundleShortVersionString': '1.0.0',
            'CFBundleName': 'ProjectRioStreamHelper',
            'NSHighResolutionCapable': True,
        },
    )
