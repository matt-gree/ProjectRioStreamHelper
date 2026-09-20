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
import subprocess
import sys
from pathlib import Path

from PyInstaller.utils.hooks import copy_metadata

block_cipher = None

# Freeze the app version into server/_version.py before bundling. This is
# the sole source of truth at runtime for frozen builds (no git available
# inside the .app/.exe). See scripts/freeze-version.py.
_freeze = Path('scripts/freeze-version.py')
if _freeze.is_file():
    subprocess.run([sys.executable, str(_freeze)], check=True)

# The same version, for the OS-level metadata below (Windows VERSIONINFO, macOS
# Info.plist). Both used to be HARDCODED — the plist said 1.0.0 for the whole
# of 2.x, so Finder, Get Info and Spotlight all reported a version the app had
# not shipped in a year, while this script sat two lines above resolving the
# real one. Read it back from the file we just wrote.
# Loaded by PATH, not by import: the file is `freeze-version.py` and a hyphen
# is not a legal module name. server/settings.py already reaches it this way.
def _resolve_app_version() -> str:
    import importlib.util
    try:
        spec = importlib.util.spec_from_file_location(
            '_freeze_version', str(_freeze.resolve()))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.resolve_version()
    except Exception:
        return '0.0.0'


_app_version = _resolve_app_version() if _freeze.is_file() else '0.0.0'


def _win_version_tuple(v: str) -> tuple:
    """`2.0.0-prerelease.14` -> (2, 0, 0, 0).

    A Windows VERSIONINFO block takes four INTEGERS and nothing else, so the
    prerelease tail and the git suffix have to come off. The readable string
    keeps the full version; only the numeric field is reduced.
    """
    core = v.lstrip('vV').split('-')[0].split('+')[0]
    parts = []
    for piece in core.split('.')[:4]:
        try:
            parts.append(int(piece))
        except ValueError:
            break
    while len(parts) < 4:
        parts.append(0)
    return tuple(parts[:4])

# Freeze the bundled gc-overlay submodule into its own one-folder app before
# we vendor it below. Built on every platform as of gc-overlay 1.1.0, which
# carries a transport for each. Builds in an isolated venv (gc-overlay's own
# deps stay out of PRSH's interpreter). Honors SKIP_GC_OVERLAY_BUILD=1.
# See scripts/build-gc-overlay.py.
_gc_overlay_dist = Path('gc-overlay/dist/gc-overlay')
_gc_build = Path('scripts/build-gc-overlay.py')
if _gc_build.is_file():
    subprocess.run([sys.executable, str(_gc_build)], check=True)

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
        # Frontend build output (only assets actually read at runtime —
        # game_assets/layout/favicon/logos are read directly from ./public/)
        ('dist/assets', 'dist/assets'),
        ('dist/.vite/manifest.json', 'dist/.vite'),
        *([('dist/vite_manifest.json', 'dist')] if _vite_staged.is_file() else []),
        ('dist/index.html', 'dist'),

        # Public directory (game assets, layouts, design packages, favicon, tray logo)
        ('public/game_assets', 'public/game_assets'),
        ('public/layout', 'public/layout'),
        ('public/design', 'public/design'),
        ('public/favicon.png', 'public'),
        ('public/logo.png', 'public'),
        ('public/logo.ico', 'public'),
        ('public/logo.icns', 'public'),
        ('public/logo_tray.png', 'public'),
        ('public/logo_tray.icns', 'public'),

        # pyrio submodule data. The hit simulator (Character Spotlight per-AB
        # trajectories) reads these off disk via __file__-relative paths, so
        # they must be copied into the bundle — PyInstaller only bundles .py
        # modules by default. Missing them makes simulate_contacts raise
        # FileNotFoundError, which server/postgame/capture.py swallows into an empty spotlight.
        ('server/rio/pyrio/CharNames.csv', 'server/rio/pyrio'),
        ('server/rio/pyrio/constants/character_attributes.csv', 'server/rio/pyrio/constants'),
        ('server/rio/pyrio/constants/stadiums', 'server/rio/pyrio/constants/stadiums'),

        # RioVisualizer submodule: pure-Python `rio_visualizer` package
        # (server/rio/hit_visualizer.py imports rio_visualizer.api). Lives
        # outside server/, so PyInstaller's import analysis never traces it —
        # server/paths.py::ensure_rio_visualizer_on_path() instead adds
        # sys._MEIPASS/rio-visualizer to sys.path at runtime and expects a
        # plain `import rio_visualizer` to find it there, same as the
        # dev-mode checkout layout. Bundled as loose source, not analyzed.
        *([('rio-visualizer/rio_visualizer', 'rio-visualizer/rio_visualizer')]
          if Path('rio-visualizer/rio_visualizer').is_dir() else []),

        # RioVisualizer's web assets (renderer.js, themes.js, etc.) — served
        # at /rio-visualizer by server/server.py for the Character Spotlight
        # fed element on the Callout Stage. Same submodule, separate subtree
        # from the Python package above; PyInstaller has no reason to trace
        # static JS, so it must be listed explicitly too.
        *([('rio-visualizer/web', 'rio-visualizer/web')]
          if Path('rio-visualizer/web').is_dir() else []),

        # Bundled gc-overlay (frozen one-folder app, built above). PRSH
        # launches the nested binary as a managed subprocess. Lands under the
        # bundle root at gc-overlay/ — see controller_overlay.py.
        *([('gc-overlay/dist/gc-overlay', 'gc-overlay')]
          if _gc_overlay_dist.is_dir() else []),

        # Frozen version stamp (generated above by scripts/freeze-version.py).
        # Read at runtime by Config.Load() since `git describe` isn't
        # available inside a packaged .app/.exe.
        *([('server/_version.py', 'server')] if Path('server/_version.py').is_file() else []),

        # A PACKAGE THAT READS ITS OWN VERSION AT IMPORT TIME NEEDS ITS
        # .dist-info IN THE BUNDLE. PyInstaller bundles modules, not
        # distribution metadata, so `importlib.metadata` finds nothing at
        # runtime and the import raises PackageNotFoundError — which, from
        # main.py's module-level `from server.state import State`, means the
        # app dies before it reaches a single line of its own code (the
        # frozen-build face of that is a PyInstaller "Unhandled exception in
        # script" dialog, no log file, no server).
        #
        # Two links of the aiopath chain do this today and neither ships a
        # PyInstaller hook: caio (`Distribution.from_name("caio").version`,
        # since 0.9.26) and aiofile (`importlib.metadata.metadata("aiofile")`).
        # The versions are unpinned, so `pip install .` on a build runner
        # picks them up whenever upstream adds the call — which is exactly how
        # this shipped broken on every platform at once. Collect the whole
        # chain recursively rather than the two known readers, so the next
        # link that grows a metadata lookup is already covered.
        *copy_metadata('aiopath', recursive=True),
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
    runtime_hooks=['installer/runtime_hook_chdir.py'],
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

# ── Windows VERSIONINFO ───────────────────────────────────────────────────
#
# Without this, PRSH.exe → right-click → Properties → Details is BLANK: no
# product name, no version, no company. That reads as "somebody's script" to a
# user, and it is also one of the signals SmartScreen and AV engines weigh —
# which matters more here than it would elsewhere, because these builds are
# unsigned. It costs a generated file and nothing at runtime.
_version_file = None
if platform.system() == 'Windows':
    _vt = _win_version_tuple(_app_version)
    _version_file = Path('build') / 'win_version_info.txt'
    _version_file.parent.mkdir(parents=True, exist_ok=True)
    _version_file.write_text(f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={_vt}, prodvers={_vt}, mask=0x3f, flags=0x0,
                    OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([
      StringTable('040904B0', [
        StringStruct('CompanyName', 'Project Rio'),
        StringStruct('FileDescription', 'ProjectRioStreamHelper'),
        StringStruct('FileVersion', {_app_version!r}),
        StringStruct('InternalName', 'PRSH'),
        StringStruct('LegalCopyright',
                     'Copyright (c) 2024 Joao Ribeiro Bezerra; '
                     '(c) 2026 Matt Greene. MIT License.'),
        StringStruct('OriginalFilename', 'PRSH.exe'),
        StringStruct('ProductName', 'ProjectRioStreamHelper'),
        StringStruct('ProductVersion', {_app_version!r}),
      ])
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
""", encoding='utf-8')

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
    version=str(_version_file) if _version_file else None,
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
        # CFBundleShortVersionString was HARDCODED at '1.0.0' through the
        # whole of 2.x, so Finder, Get Info and Spotlight reported a version
        # the app had not shipped in a year. CFBundleVersion (the build
        # string) was absent entirely, which macOS expects alongside it.
        info_plist={
            'CFBundleShortVersionString': '.'.join(
                str(n) for n in _win_version_tuple(_app_version)[:3]),
            'CFBundleVersion': _app_version,
            'CFBundleName': 'ProjectRioStreamHelper',
            'CFBundleDisplayName': 'PRSH',
            'NSHumanReadableCopyright':
                'Copyright (c) 2024 João Ribeiro Bezerra; '
                '(c) 2026 Matt Greene. MIT License.',
            'NSHighResolutionCapable': True,
        },
    )
