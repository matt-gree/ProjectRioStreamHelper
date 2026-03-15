from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import ORJSONResponse

router = APIRouter()

_layout_dir = Path("./public/layout")

@router.get("/layouts", response_class=ORJSONResponse)
async def list_layouts(request: Request):
    """Return all available OBS layout HTML files grouped by folder."""
    host = request.headers.get("host", "localhost:5260")
    base = f"http://{host}"
    layouts = []

    if _layout_dir.is_dir():
        for group in sorted(_layout_dir.iterdir()):
            if not group.is_dir():
                continue
            for f in sorted(group.iterdir()):
                if f.suffix == ".html":
                    rel = f.relative_to(_layout_dir)
                    layouts.append({
                        "group": group.name,
                        "name": f.stem,
                        "url": f"{base}/layout/{rel}",
                    })

    return ORJSONResponse(layouts)
