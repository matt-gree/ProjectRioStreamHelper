import re
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import ORJSONResponse

router = APIRouter()

_layout_dir = Path("./public/layout")

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
# Each: (size_code, label, width, height)
_SIZE_VARIANTS = {
    "scoreboard": [
        ("xs", "Extra Small", 400, 50),
        ("s",  "Small",       500, 80),
        ("m",  "Medium",      600, 200),
        ("l",  "Large",       800, 400),
        ("xl", "Extra Large", 1000, 500),
    ],
}

# Team variants for layouts that support ?team= param.
# Each: (team_num, label)
_TEAM_VARIANTS = {
    "stats":     [(1, "Team 1"), (2, "Team 2")],
    "roster":    [(1, "Team 1"), (2, "Team 2")],
    "teamlogo":  [(1, "Team 1"), (2, "Team 2")],
}

# Human-readable display names for layout types shown in the UI
_DISPLAY_NAMES = {
    "stats":    "Stats",
    "roster":   "Roster",
    "teamlogo": "Team Logo",
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
        gameplay (group=scenes) -> "scene"
    """
    # For scenes folder, all files are scene type
    if group == "scenes":
        return "scene"
    # For bracket folder, all files are bracket type
    if group == "bracket":
        return "bracket"
    # Strip trailing digits to collapse team-specific variants
    base = stem.rstrip("0123456789")
    return base if base else stem


@router.get("/layouts", response_class=ORJSONResponse)
async def list_layouts(request: Request):
    """Return all available OBS layout HTML files grouped by folder path."""
    host = request.headers.get("host", "localhost:5260")
    base = f"http://{host}"
    layouts = []

    if _layout_dir.is_dir():
        for f in sorted(_layout_dir.rglob("*.html")):
            rel = f.relative_to(_layout_dir)
            group = str(rel.parent) if rel.parent != Path(".") else "ungrouped"
            layout_type = _derive_type(f.stem, group)
            base_url = f"{base}/layout/{rel}"

            # If this layout type has size variants, expand into multiple entries
            w, h, supported = _parse_html_meta(f)

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
                entry = {
                    "group": group,
                    "name": f.stem,
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
