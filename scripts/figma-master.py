#!/usr/bin/env python3
"""Compose every generated Figma template into ONE master sheet.

    python scripts/figma-template.py --write     # refresh the per-element templates first
    python scripts/figma-master.py               # -> design-templates/master.svg

The sheet is a map of the whole package: every themed element at its NATIVE
size in its own labelled frame, with the gutters between frames fixed so the
elements can be compared at true scale. Nothing inside a frame is changed —
slot/part/scaffold layer names, the dashed image boxes (logos, character
icons, captain art) and the cyan stage guides all come through as the
per-element template drew them.

Each element is a nested <svg id="element=NAME">, which a design tool imports
as a FRAME of its own with its own coordinates, so an edited frame exports as a
standalone file that scripts/compile-theme.py reads like any per-element
template. Turning a set of those into a package is done by hand (with Claude),
on purpose: a reskin carries intent a script cannot read. An element's frame may
be wider than the element itself - alternates and spare prototypes sit beside
the magenta native frame (see the per-element template header).

Shared defs (the `rio-mark` sprite, the social glyphs) are emitted once; a def
id that two templates define DIFFERENTLY is prefixed with its element name so
neither overwrites the other.
"""
import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)

MARGIN = 120      # canvas edge to first frame
GUTTER = 120      # frame to frame, both axes
LABEL_H = 56      # label band above each frame
CANVAS_W = 2 * 1920 + GUTTER + 2 * MARGIN

# Reading order: the scoreboard family first, then the full-width graphics.
ORDER = [
    "scoreboard-l", "scoreboard-s", "statsbar", "statscard", "scorecard",
    "commentary", "playerplates", "ticker",
    "lowerthird", "matchup", "schedule", "callout",
]


def q(tag: str) -> str:
    return f"{{{SVG_NS}}}{tag}"


def load(path: Path) -> tuple[ET.Element, float, float]:
    root = ET.fromstring(path.read_text())
    _, _, w, h = (float(v) for v in root.get("viewBox").split())
    return root, w, h


def dedupe_defs(elem: str, root: ET.Element, seen: dict[str, str]) -> ET.Element:
    """Re-parse the template with colliding def ids prefixed, and strip defs
    another template has already contributed verbatim."""
    text = ET.tostring(root, encoding="unicode")
    renames = {}
    for defs in root.iter(q("defs")):
        for child in defs:
            did = child.get("id")
            if not did:
                continue
            body = ET.tostring(child, encoding="unicode")
            if did in seen and seen[did] != body:
                renames[did] = f"{elem}--{did}"
    for old, new in renames.items():
        text = re.sub(rf'id="{re.escape(old)}"', f'id="{new}"', text)
        text = re.sub(rf'url\(#{re.escape(old)}\)', f'url(#{new})', text)
        text = re.sub(rf'href="#{re.escape(old)}"', f'href="#{new}"', text)
    root = ET.fromstring(text)
    for defs in list(root.iter(q("defs"))):
        for child in list(defs):
            did = child.get("id")
            if not did:
                continue
            body = ET.tostring(child, encoding="unicode")
            if seen.get(did) == body:
                defs.remove(child)
            else:
                seen[did] = body
    return root


def shelf_pack(sizes: list[tuple[str, float, float]]) -> tuple[list[tuple[str, float, float]], float]:
    """Left-to-right rows, wrapping at the canvas width, rows GUTTER apart."""
    out, x, y, row_h = [], MARGIN, MARGIN, 0.0
    for name, w, h in sizes:
        if x > MARGIN and x + w > CANVAS_W - MARGIN:
            x, y, row_h = MARGIN, y + row_h + GUTTER, 0.0
        out.append((name, x, y + LABEL_H))
        x += w + GUTTER
        row_h = max(row_h, h + LABEL_H)
    return out, y + row_h + MARGIN


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default="design-templates", help="folder of *.template.svg")
    ap.add_argument("--out", default="design-templates/master.svg")
    args = ap.parse_args()

    src = Path(args.dir)
    found = {p.name.removesuffix(".template.svg"): p for p in src.glob("*.template.svg")}
    names = [n for n in ORDER if n in found] + sorted(set(found) - set(ORDER))
    if not names:
        print(f"no templates in {src} - run scripts/figma-template.py --write", file=sys.stderr)
        return 1

    loaded = {n: load(found[n]) for n in names}
    placed, canvas_h = shelf_pack([(n, loaded[n][1], loaded[n][2]) for n in names])

    master = ET.Element(q("svg"), {
        "viewBox": f"0 0 {CANVAS_W} {canvas_h:g}",
        "width": str(CANVAS_W), "height": f"{canvas_h:g}",
    })
    ET.SubElement(master, q("rect"), {
        "id": "scaffold=canvas", "x": "0", "y": "0",
        "width": str(CANVAS_W), "height": f"{canvas_h:g}", "fill": "#2A2A33",
    })

    seen_defs: dict[str, str] = {}
    for name, x, y in placed:
        root, w, h = loaded[name]
        root = dedupe_defs(name, root, seen_defs)

        label = ET.SubElement(master, q("text"), {
            "id": f"scaffold=label-{name}", "x": f"{x:g}", "y": f"{y - 18:g}",
            "fill": "#C9C9D6", "font-family": "Inter, sans-serif",
            "font-size": "28", "font-weight": "600",
        })
        native = next((c.get("id") for c in root if (c.get("id") or "").startswith("frame=")), None)
        label.text = f"{name}  \u00b7  {native[6:] if native else f'{w:g}x{h:g}'}"

        # A nested <svg> is a FRAME in a design tool: its own origin, exported
        # on its own. The template's root attributes (preserveAspectRatio, the
        # layout mode) ride on it unchanged.
        frame = ET.SubElement(master, q("svg"), {
            "id": f"element={name}",
            "x": f"{x:g}", "y": f"{y:g}", "width": f"{w:g}", "height": f"{h:g}",
            "viewBox": f"0 0 {w:g} {h:g}",
        })
        for attr, value in root.attrib.items():
            if attr not in ("viewBox", "width", "height", "x", "y", "id"):
                frame.set(attr, value)
        # The overlay is transparent over the broadcast; a dark stand-in for the
        # game feed keeps white type legible. Editing aid only.
        ET.SubElement(frame, q("rect"), {
            "id": f"scaffold=backdrop-{name}", "x": "0", "y": "0",
            "width": f"{w:g}", "height": f"{h:g}", "fill": "#14141A",
        })
        for child in list(root):
            frame.append(child)
        if native is None:
            # A widened template draws its own frame bounds; mark the rest.
            ET.SubElement(frame, q("rect"), {
                "id": f"scaffold=bounds-{name}", "x": "0", "y": "0",
                "width": f"{w:g}", "height": f"{h:g}", "fill": "none",
                "stroke": "#FF00FF", "stroke-width": "2", "stroke-dasharray": "12 8",
            })

    Path(args.out).write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!-- GENERATED by scripts/figma-master.py from design-templates/*.template.svg.\n"
        "     Every themed element, one frame each (element=NAME), at true scale.\n"
        "     Round trip: restyle, export the element frames as SVG, and hand\n"
        "     them back to be compiled into a design package.\n"
        "     Magenta dashed = what ships; grey dashed = alternates and spare\n"
        "     prototypes laid out beside it; cyan dashed = runtime stage sizes;\n"
        "     scaffold=preview-* = copies that show spacing and never ship.\n"
        "     Read design-templates/README.md before editing. -->\n"
        + ET.tostring(master, encoding="unicode")
    )
    print(f"{args.out}: {len(placed)} elements on {CANVAS_W} x {canvas_h:g}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
