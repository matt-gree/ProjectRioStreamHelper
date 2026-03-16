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


@router.get("/layouts", response_class=ORJSONResponse)
async def list_layouts(request: Request):
    """Return all available OBS layout HTML files grouped by folder path."""
    host = request.headers.get("host", "localhost:5260")
    base = f"http://{host}"
    layouts = []

    if _layout_dir.is_dir():
        for f in sorted(_layout_dir.rglob("*.html")):
            rel = f.relative_to(_layout_dir)
            # Group name is the parent path relative to layout dir (e.g. "scoreboard1/hud")
            group = str(rel.parent) if rel.parent != Path(".") else "ungrouped"
            w, h = _parse_body_dims(f)
            entry = {
                "group": group,
                "name": f.stem,
                "url": f"{base}/layout/{rel}",
            }
            if w is not None and h is not None:
                entry["width"] = w
                entry["height"] = h
            layouts.append(entry)

    return ORJSONResponse(layouts)
