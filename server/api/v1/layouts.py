import platform
import re
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import ORJSONResponse

from server.paths import app_root
from server.settings import Settings

router = APIRouter()

_layout_dir = app_root() / "public" / "layout"

# Shared containers are PRODUCER-BUILT, so they are not files to enumerate.
# One generic shell renders every one of them (?container={id}), and the
# catalog rows come from `production.container_defs` instead — which is what
# gives each row the container's own name and native size. The folder is
# skipped wholesale: the pre-2.0 named shells (callout-stage.html and friends)
# stay on disk so browser sources already pointing at them keep rendering, but
# offering them alongside the definitions would list the same container twice.
_CONTAINER_GROUP = "shared"
_CONTAINER_SHELL = "/layout/shared/container.html"


def layout_url(base: str, rel) -> str:
    """The browser-source URL for a layout file, from its path under _layout_dir.

    `as_posix`, never `str(rel)`. A Path renders with the NATIVE separator, so on
    Windows this produced `…/layout/scoreboard1\\roster.html`. Browsers forgive
    that (the URL spec folds "\\" to "/" for http), which is exactly why it would
    survive a smoke test — but the element registry does not: every `match` in
    src/routes/production/elements.js is a regex over the raw URL, and the ones
    without a bare-filename fallback (roster, schedule, bracket, ticker) simply
    stop matching. The console then files a known element as a generic layout,
    which costs it its stage panel, preview and style settings.
    """
    return f"{base}/layout/{rel.as_posix()}"

# The controller browser-source wraps gc-overlay, which only runs on macOS.
# Hide that layout group from the catalog on other platforms.
_CONTROLLER_SUPPORTED = platform.system() == "Darwin"

_body_w_re = re.compile(r"body\s*\{[^}]*width:\s*(\d+)px", re.DOTALL)
_body_h_re = re.compile(r"body\s*\{[^}]*height:\s*(\d+)px", re.DOTALL)
_settings_re = re.compile(
    r'<meta\s+name="overlay-settings"\s+content="([^"]*)"', re.IGNORECASE
)


def _parse_html_meta(path: Path) -> tuple[int | None, int | None, list[str] | None]:
    """Extract body dims and overlay-settings from an HTML file."""
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return None, None, None
    w_m = _body_w_re.search(text)
    h_m = _body_h_re.search(text)
    s_m = _settings_re.search(text)
    w = int(w_m.group(1)) if w_m else None
    h = int(h_m.group(1)) if h_m else None
    supported = (
        [s.strip() for s in s_m.group(1).split(",") if s.strip()]
        if s_m is not None
        else None
    )
    return w, h, supported


# Size variants for layouts that support ?size= param.
# Each: (size_code, label, width, height). Dims are the theme SVG's native
# canvas (viewBox) — the recommended OBS browser-source size — and come from
# theme_contracts.CONTRACTS, the single Python source of truth (the JS copies
# in scoreboard-mount.js / layouts.jsx / elements.js are pinned to it by
# tests/unit/test_size_dims_parity.py). The xl variant was retired with the
# SVG conversion; the mount treats unknown/legacy sizes (including ?size=xl
# sources that still exist in OBS) as "l".
def _scoreboard_canvas(size: str) -> tuple[int, int]:
    from server.theme_contracts import CONTRACTS

    return CONTRACTS[f"scoreboard-{size}"].canvas


_SIZE_VARIANTS = {
    "scoreboard": [
        ("s",  "Small",  *_scoreboard_canvas("s")),
        ("m",  "Medium", *_scoreboard_canvas("m")),
        ("l",  "Large",  *_scoreboard_canvas("l")),
    ],
}

# Team variants for layouts that support ?team= param.
# Each: (team_num, label)
_TEAM_VARIANTS = {
    "stats":       [(1, "Team 1"), (2, "Team 2")],
    "roster":      [(1, "Team 1"), (2, "Team 2")],
    "teamlogo":    [(1, "Team 1"), (2, "Team 2")],
    "controller":  [(1, "Team 1"), (2, "Team 2")],
    "playername":  [(1, "Team 1"), (2, "Team 2")],
}

# Human-readable display names for layout types shown in the UI
_DISPLAY_NAMES = {
    "stats":       "Stats",
    "roster":      "Roster",
    "teamlogo":    "Team Logo",
    "controller":  "Controller",
    "playername":  "Player Name",
}

# Fallback dimensions for layouts whose body is fluid (e.g. body { width: 100%
# }) so _parse_html_meta returns None. Used as the recommended OBS browser-
# source size displayed in the layouts list. Bracket scales to fit any source,
# but 1920x1080 is the typical streaming canvas users size against.
_DEFAULT_DIMS = {
    "bracket": (1920, 1080),
}

# Friendlier display names keyed by "{group}/{stem}" for the catch-all branch
# (single-variant standalone layouts that aren't size or team variants).
_STANDALONE_DISPLAY_NAMES = {
    "rotator/ticker": "Results Ticker",
    # Talent — registry-bound person overlays.
    "commentary/commentary": "Commentary",
    # Two-player name/sub-plate band (both L/R, or one player at left/center/
    # right), fed from a match or manual names (playerplates.*).
    "playerplates/playerplates": "Player Plates",
    # Break — re-themable SVG lower-third band: five producer-picked slots
    # (logo · match · scorebox · merch · clock · message · bracket).
    "lowerthird/lowerthird": "Lower Third",
    # The producer's ordered match queue (schedule.queue → match.{M}).
    "schedule/schedule": "Upcoming Schedule",
    # Head-to-head band: all-time series summary + last-5 game cards for a
    # match's two participants, fetched from the Project Rio API (matchup.*).
    "matchup/matchup": "Matchup History",
    # Vertical Scorecard: a tall re-themable SVG scoreboard whose eight design
    # elements each toggle/animate independently (overlays.scorecard.*).
    "scorecard/scorecard": "Vertical Scorecard",
    # Post-game callouts — each one's OWN full-canvas source. Both are also
    # container MEMBERS: a producer who wants them mutually exclusive puts both
    # on one container's roster instead, and that container is a catalog row of
    # its own (see _container_layouts). The two paths are the same elements,
    # not two spellings of one — which is why these files are listed even
    # though the Callout Stage container usually holds them.
    "postgame/spotlight": "Character Spotlight",
    "postgame/summary": "Game Summary",
    # Event Header: a centered two-row tournament banner (1263px). Top row =
    # Competition / Location / Dates from tournamentInfo; bottom row = Message /
    # Event / Phase / Round — the message is the element's own copy
    # (overlays.eventheader.message), the rest tournamentInfo and the bound
    # match. Blank fields drop out and the rest re-center.
    "eventheader/eventheader": "Event Header",
}


def _derive_type(stem: str, group: str = "") -> str:
    """Derive a layout type from the filename stem and group folder.

    Examples:
        scoreboard              -> "scoreboard"
        roster                  -> "roster"
        stats                   -> "stats"
        teamlogo                -> "teamlogo"
        index (group=bracket)   -> "bracket"
        winners_only (bracket)  -> "bracket"
    """
    # For bracket folder, all files are bracket type
    if group == "bracket":
        return "bracket"
    # Strip trailing digits to collapse team-specific variants
    base = stem.rstrip("0123456789")
    return base if base else stem


def _container_layouts(base: str) -> list[dict]:
    """Catalog rows for the producer's shared containers, one per definition.

    A container is config, not a file: `production.container_defs.{id}` carries
    its display name, its native size (the largest member's, since smaller
    members center and never scale) and its member roster. Every one of them is
    rendered by the same generic shell, told which definition to be.
    """
    defs = Settings.Get("production.container_defs", {}) or {}
    shell = _layout_dir / "shared" / "container.html"
    _, _, supported = _parse_html_meta(shell)

    rows = []
    for cid, cdef in sorted(defs.items()):
        if not isinstance(cdef, dict):
            continue
        entry = {
            "group": _CONTAINER_GROUP,
            "name": cdef.get("name") or cid,
            "type": "container",
            "url": f"{base}{_CONTAINER_SHELL}?container={cid}",
            "container": cid,
            "members": list(cdef.get("members") or []),
        }
        w, h = cdef.get("width"), cdef.get("height")
        if isinstance(w, int) and isinstance(h, int):
            entry["width"] = w
            entry["height"] = h
        if supported is not None:
            entry["supportedSettings"] = supported
        rows.append(entry)
    return rows


@router.get("/layouts", response_class=ORJSONResponse)
async def list_layouts(request: Request):
    """Return all available OBS layout HTML files grouped by folder path."""
    host = request.headers.get("host", "localhost:5260")
    base = f"http://{host}"
    layouts = _container_layouts(base)

    if _layout_dir.is_dir():
        for f in sorted(_layout_dir.rglob("*.html")):
            rel = f.relative_to(_layout_dir)
            group = str(rel.parent) if rel.parent != Path(".") else "ungrouped"

            # gc-overlay is macOS-only; omit its browser source elsewhere.
            if not _CONTROLLER_SUPPORTED and group == "controller":
                continue

            # Containers come from the definitions above, not from the folder.
            if group == _CONTAINER_GROUP:
                continue

            layout_type = _derive_type(f.stem, group)
            base_url = layout_url(base, rel)

            # If this layout type has size variants, expand into multiple entries
            w, h, supported = _parse_html_meta(f)
            if (w is None or h is None) and layout_type in _DEFAULT_DIMS:
                w, h = _DEFAULT_DIMS[layout_type]

            size_variants = _SIZE_VARIANTS.get(layout_type)
            team_variants = _TEAM_VARIANTS.get(layout_type)
            if size_variants:
                for size_code, size_label, sw, sh in size_variants:
                    entry = {
                        "group": group,
                        "name": f.stem,
                        "type": layout_type,
                        "url": f"{base_url}?size={size_code}",
                        "width": sw,
                        "height": sh,
                        "parentName": f.stem.capitalize(),
                        "sizeVariant": size_code,
                        "sizeLabel": size_label,
                    }
                    if supported is not None:
                        entry["supportedSettings"] = supported
                    layouts.append(entry)
            elif team_variants:
                display_name = _DISPLAY_NAMES.get(layout_type, layout_type.capitalize())
                for team_num, _team_label in team_variants:
                    entry = {
                        "group": group,
                        "name": display_name,
                        "type": layout_type,
                        "url": f"{base_url}?team={team_num}",
                        "team": team_num,
                    }
                    if w is not None and h is not None:
                        entry["width"] = w
                        entry["height"] = h
                    if supported is not None:
                        entry["supportedSettings"] = supported
                    layouts.append(entry)
            else:
                display = _STANDALONE_DISPLAY_NAMES.get(f"{group}/{f.stem}", f.stem)
                entry = {
                    "group": group,
                    "name": display,
                    "type": layout_type,
                    "url": base_url,
                }
                if w is not None and h is not None:
                    entry["width"] = w
                    entry["height"] = h
                if supported is not None:
                    entry["supportedSettings"] = supported
                layouts.append(entry)

    return ORJSONResponse(layouts)
