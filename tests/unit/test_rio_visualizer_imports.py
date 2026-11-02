"""Every module the overlays import from rio-visualizer has to resolve offline.

PRSH serves the visualizer's web/ folder but vendors three.js itself, and a static import
that 404s stops the whole module graph, so the overlay never mounts. A bump of the
submodule can add an addon without touching anything in this repo, and neither vitest nor
eslint follows those imports, so walk the graph here.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LAYOUT_LIB = ROOT / "public" / "layout" / "lib"
ADDONS = LAYOUT_LIB / "three" / "addons"
VISUALIZER_WEB = ROOT / "rio-visualizer" / "web"

# The two places PRSH loads the visualizer from
ENTRY_POINTS = [LAYOUT_LIB / "hit-mount.js", LAYOUT_LIB / "postgame-callout-theater.js"]

IMPORT_RE = re.compile(
    r"""^\s*(?:(?:import|export)\b[^'"\n]*\bfrom\s+|\}\s*from\s+|import\s+)['"]([^'"]+)['"]""",
    re.MULTILINE,
)


def imports_of(path: Path) -> list[str]:
    return IMPORT_RE.findall(path.read_text(encoding="utf-8"))


def resolve(specifier: str, importer: Path) -> Path | None:
    """The file a browser would load, or None for three itself, which is always vendored."""
    if specifier == "three":
        return None
    if specifier.startswith("three/addons/"):
        return ADDONS / specifier.removeprefix("three/addons/")
    if specifier.startswith("/rio-visualizer/"):
        return VISUALIZER_WEB / specifier.removeprefix("/rio-visualizer/")
    return (importer.parent / specifier).resolve()


def walk(start: Path) -> tuple[set[Path], list[str]]:
    """Follow imports from start. Returns the modules reached and any that are missing."""
    reached, missing = set(), []
    pending = [
        (resolve(spec, start), spec, start)
        for spec in imports_of(start)
        if spec.startswith("/rio-visualizer/")
    ]
    while pending:
        target, specifier, importer = pending.pop()
        if target is None or target in reached:
            continue
        if not target.is_file():
            missing.append(f"{importer.name} imports {specifier}")
            continue
        reached.add(target)
        pending.extend((resolve(spec, target), spec, target) for spec in imports_of(target))
    return reached, missing


@pytest.mark.parametrize("entry", ENTRY_POINTS, ids=lambda path: path.name)
def test_visualizer_module_graph_resolves(entry):
    reached, missing = walk(entry)
    assert reached, f"{entry.name} no longer imports rio-visualizer"
    assert not missing


def test_import_scan_sees_multiline_and_side_effect_imports():
    source = "import {\n  A,\n} from 'three';\nimport './side.js';\n// copied from 'nowhere.js'\n"
    assert IMPORT_RE.findall(source) == ["three", "./side.js"]
