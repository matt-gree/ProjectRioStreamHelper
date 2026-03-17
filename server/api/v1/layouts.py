import re
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import ORJSONResponse

router = APIRouter()

_layout_dir = Path("./public/layout")

_body_w_re = re.compile(r"body\s*\{[^}]*width:\s*(\d+)px", re.DOTALL)
_body_h_re = re.compile(r"body\s*\{[^}]*height:\s*(\d+)px", re.DOTALL)


def _parse_body_dims(path: Path) -> tuple[int | None, int | None]:
    """Extract width/height from the body CSS rule in an HTML file."""
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return None, None
    w_m = _body_w_re.search(text)
    h_m = _body_h_re.search(text)
    return (int(w_m.group(1)) if w_m else None, int(h_m.group(1)) if h_m else None)


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


def _derive_type(stem: str) -> str:
    """Derive a layout type from the filename stem.

    Examples:
        scoreboard  -> "scoreboard"
        roster1     -> "roster"
        roster2     -> "roster"
        stats1      -> "stats"
        stats2      -> "stats"
        team1logo   -> "teamlogo"
        team2logo   -> "teamlogo"
    """
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
            layout_type = _derive_type(f.stem)
            base_url = f"{base}/layout/{rel}"

            # If this layout type has size variants, expand into multiple entries
            variants = _SIZE_VARIANTS.get(layout_type)
            if variants:
                for size_code, size_label, sw, sh in variants:
                    layouts.append({
                        "group": group,
                        "name": f.stem,
                        "type": layout_type,
                        "url": f"{base_url}?size={size_code}",
                        "width": sw,
                        "height": sh,
                        "parentName": f.stem.capitalize(),
                        "sizeVariant": size_code,
                        "sizeLabel": size_label,
                    })
            else:
                w, h = _parse_body_dims(f)
                entry = {
                    "group": group,
                    "name": f.stem,
                    "type": layout_type,
                    "url": base_url,
                }
                if w is not None and h is not None:
                    entry["width"] = w
                    entry["height"] = h
                layouts.append(entry)

    return ORJSONResponse(layouts)
