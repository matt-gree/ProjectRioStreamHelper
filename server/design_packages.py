"""Design Packages — swappable element-theme bundles.

A design package is a folder of themed SVGs — one per re-themable element
(``commentary.svg``, ``lowerthird.svg``, ``callout.svg``, …) — plus an optional
``package.json`` manifest (display name / author / version / description).

Two packages ship built-in under ``./public/design/`` and are part of the
codebase:

* ``default`` — the Project Rio brand look (night-arena palette, Rio red,
  Rajdhani display type; from the Project Rio design system).
* ``classic`` — follows the user's Design-tab CSS knobs (accent, card
  background, fonts, …), i.e. the pre-2.0 PRSH overlay look.

Every other package is user-installed under ``user_data/design_packages/<id>/``
and stays out of the repository. Install = drop a folder there (or upload a
.zip through the Design tab); uninstall = delete it.

Resolution rules:

* A built-in id always wins — an installed package cannot shadow ``default`` or
  ``classic``.
* Asset lookups fall back **element-by-element** to the ``default`` package
  (handled client-side by svg-theme-engine.js): a package may theme any subset
  of elements and the rest keep the Default look.
"""
import json
import re
import shutil
import zipfile
from io import BytesIO
from pathlib import Path

from loguru import logger

from server.paths import app_root, user_data_dir

# Built-in packages live next to the other served static assets; PRSH.spec
# bundles this folder the same way it bundles public/layout.
BUILTIN_DIR = app_root() / "public" / "design"

# Package ids are folder names and URL path segments — keep them boring.
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")

# What an installed zip may contain. SVG themes + manifest + docs + raster
# sources; anything else (scripts, binaries) is skipped on extract.
_ALLOWED_SUFFIXES = {".svg", ".json", ".md", ".png", ".jpg", ".jpeg", ".webp", ".txt"}
_MAX_PACKAGE_BYTES = 32 * 1024 * 1024


def user_packages_dir() -> Path:
    return user_data_dir() / "design_packages"


def is_builtin(package_id: str) -> bool:
    return (BUILTIN_DIR / package_id).is_dir()


def _read_manifest(folder: Path) -> dict:
    p = folder / "package.json"
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        logger.warning("[Design] unreadable manifest in {}", folder)
        return {}


# The root <svg> tag — the first element in the file, and the only one that
# carries the palette declaration. Matched against a bounded read: a themed SVG
# can be hundreds of KB of pixel art we have no reason to load to answer this.
_SVG_TAG_RE = re.compile(r"<svg\b[^>]*>", re.IGNORECASE)
_APP_VARS_RE = re.compile(r"""data-design-vars\s*=\s*["']app["']""", re.IGNORECASE)


def _uses_app_vars(svg: Path) -> bool:
    """Whether this theme file opts into the user's Design-tab palette.

    A theme declares ``data-design-vars="app"`` on its root ``<svg>`` to be
    painted by the app's colour/typography knobs (a *token skin*); without it it
    brings a fixed palette and the mount CLEARS those vars instead — the
    ``usesAppVars`` branch in svg-theme-engine.js. So for a full-art element the
    app-palette settings are dead, and the UI hides them.

    Read from the shipped FILE, not the manifest: ``palette`` there is only an
    input to the theme compiler, and a folder dropped in by hand never runs it.
    """
    try:
        with svg.open("r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(8192)
    except OSError:
        return False
    tag = _SVG_TAG_RE.search(head)
    return bool(tag and _APP_VARS_RE.search(tag.group(0)))


def _package_info(folder: Path, builtin: bool) -> dict:
    manifest = _read_manifest(folder)
    svgs = sorted(folder.glob("*.svg"))
    return {
        "id": folder.name,
        "name": manifest.get("name") or folder.name,
        "description": manifest.get("description") or "",
        "author": manifest.get("author") or "",
        "version": manifest.get("version") or "",
        "builtin": builtin,
        # Which elements this package themes = which theme SVGs exist.
        "elements": [p.stem for p in svgs],
        # ...and which of those are painted by the user's Design-tab knobs. The
        # tier is per ELEMENT, never per package: `classic` is a token skin that
        # still ships a full-art callout.svg and no statscard at all, and an
        # element a package omits falls back to `default`, which is full-art.
        "appVarElements": [p.stem for p in svgs if _uses_app_vars(p)],
    }


def list_packages() -> list[dict]:
    """All installed packages, built-ins first (default, then classic)."""
    out: list[dict] = []
    seen: set[str] = set()
    if BUILTIN_DIR.is_dir():
        builtin = {f.name: f for f in BUILTIN_DIR.iterdir() if f.is_dir()}
        for pinned in ("default", "classic"):
            if pinned in builtin:
                out.append(_package_info(builtin.pop(pinned), True))
                seen.add(pinned)
        for name in sorted(builtin):
            out.append(_package_info(builtin[name], True))
            seen.add(name)
    udir = user_packages_dir()
    if udir.is_dir():
        for folder in sorted(udir.iterdir()):
            if folder.is_dir() and not folder.name.startswith(".") and folder.name not in seen:
                out.append(_package_info(folder, False))
    return out


def resolve_asset(package_id: str, filename: str) -> Path | None:
    """The on-disk file for ``/design/{package_id}/{filename}``, or None.

    Both segments are validated (no separators, no dotfiles) so this can never
    escape the two package roots. Built-in beats user for the same id.
    """
    if not _ID_RE.match(package_id or ""):
        return None
    if (
        not filename
        or filename.startswith(".")
        or "/" in filename
        or "\\" in filename
        or Path(filename).suffix.lower() not in _ALLOWED_SUFFIXES
    ):
        return None
    for base in (BUILTIN_DIR, user_packages_dir()):
        p = base / package_id / filename
        if p.is_file():
            return p
    return None


def _zip_root(names: list[str]) -> str:
    """The single top-level folder every entry lives under, or '' (flat zip)."""
    roots = {n.split("/", 1)[0] for n in names if n.strip("/")}
    if len(roots) == 1:
        root = roots.pop()
        if all(n.startswith(root + "/") for n in names if "/" in n or n != root):
            return root
    return ""


def install_zip(data: bytes, fallback_id: str | None = None) -> dict:
    """Install a package from zip bytes into ``user_data/design_packages/``.

    The package id comes from the manifest's ``id``, else the zip's single root
    folder, else ``fallback_id`` (the uploaded filename's stem). Replaces any
    existing user package with that id; refuses built-in ids. Returns the
    installed package's info dict. Raises ValueError on a bad archive.
    """
    if len(data) > _MAX_PACKAGE_BYTES:
        raise ValueError("package is too large (32 MB max)")
    try:
        zf = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("not a valid .zip archive")

    names = [i.filename for i in zf.infolist() if not i.is_dir()]
    if not names:
        raise ValueError("archive is empty")
    root = _zip_root(names)

    def rel(name: str) -> str | None:
        """Sanitized path inside the package, or None to skip the entry."""
        r = name[len(root) + 1 :] if root and name.startswith(root + "/") else name
        # A zip entry is spec'd to use "/" only, so a backslash is either a
        # broken writer or an attempt to smuggle a separator past this check.
        # Splitting on "/" alone let `a\..\..\x.svg` through as ONE part, which
        # is inert on POSIX but is a real separator on Windows — pathlib joins
        # it unchanged and the OS resolves it outside the package.
        parts = [p for p in r.replace("\\", "/").split("/") if p]
        if (
            not parts
            or any(p in ("..", "") or p.startswith(".") for p in parts)
            or Path(parts[-1]).suffix.lower() not in _ALLOWED_SUFFIXES
        ):
            return None
        return "/".join(parts)

    entries = [(n, rel(n)) for n in names]
    kept = [(n, r) for n, r in entries if r]
    if not any(r.endswith(".svg") for _, r in kept):
        raise ValueError("archive contains no theme SVGs")

    # Resolve the package id: manifest > zip root folder > uploaded filename.
    manifest = {}
    manifest_name = next((n for n, r in kept if r == "package.json"), None)
    if manifest_name:
        try:
            manifest = json.loads(zf.read(manifest_name).decode("utf-8"))
        except Exception:
            manifest = {}
    package_id = str(manifest.get("id") or root or fallback_id or "").strip().lower()
    package_id = re.sub(r"[^a-z0-9._-]+", "-", package_id).strip("-.")
    if not _ID_RE.match(package_id):
        raise ValueError("could not determine a valid package id (set \"id\" in package.json)")
    if is_builtin(package_id):
        raise ValueError(f"'{package_id}' is a built-in package and cannot be replaced")

    total = sum(zf.getinfo(n).file_size for n, _ in kept)
    if total > _MAX_PACKAGE_BYTES:
        raise ValueError("package is too large (32 MB max)")

    dest = user_packages_dir() / package_id
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    dest_resolved = dest.resolve()
    for name, r in kept:
        target = dest / r
        # Belt and braces: `rel` already sanitized this, but an extraction that
        # writes wherever the archive says is the one bug worth failing closed
        # on. Resolve and prove containment rather than trusting the sanitizer.
        if not target.resolve().is_relative_to(dest_resolved):
            raise ValueError(f"archive entry escapes the package directory: {name!r}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(zf.read(name))

    report = compile_installed_svgs(dest, palette=manifest.get("palette"))

    info = _package_info(dest, builtin=False)
    info["report"] = report
    logger.info("[Design] installed package '{}' ({} files)", package_id, len(kept))
    return info


def compile_installed_svgs(folder: Path, palette: str | None = None) -> list[dict]:
    """Run the theme compiler over a package's top-level SVGs, in place.

    Translates the designer layer-naming grammar into data-* markers and lints
    each file against its element contract (see server/theme_compiler.py).
    Files under sources/ are untouched. A compiler failure never blocks the
    install — the raw file stays and the report says so.
    """
    from server.theme_compiler import compile_svg  # local: keep module import light

    report: list[dict] = []
    for svg in sorted(folder.glob("*.svg")):
        element = svg.stem
        try:
            out, file_report = compile_svg(
                svg.read_text(encoding="utf-8"), element, filename=svg.name, palette=palette,
            )
            if file_report.changed:
                svg.write_text(out, encoding="utf-8")
            report.append(file_report.to_dict())
        except Exception as e:
            logger.exception("[Design] theme compiler failed on {}", svg.name)
            report.append({
                "file": svg.name, "element": element, "changed": False,
                "bound": None, "total": None,
                "findings": [{"level": "error", "message": f"theme compiler failed ({e}) — installed as-is"}],
            })
    return report


def delete_package(package_id: str) -> None:
    """Remove a user-installed package. Raises ValueError for built-ins/missing."""
    if not _ID_RE.match(package_id or ""):
        raise ValueError("invalid package id")
    if is_builtin(package_id):
        raise ValueError("built-in packages cannot be removed")
    dest = user_packages_dir() / package_id
    if not dest.is_dir():
        raise ValueError(f"package '{package_id}' is not installed")
    shutil.rmtree(dest)
    logger.info("[Design] removed package '{}'", package_id)
