"""Generate Figma-editable reimport templates from shipped theme SVGs.

The exact inverse of ``server/theme_compiler.py``. The compiler takes a
designer's export and produces a shipped theme SVG; this takes a shipped theme
SVG and produces the editable source the designer opens in Figma. Together they
close the round trip:

    design-templates/<el>.template.svg  --Figma-->  export.svg
        ^                                              |
        |  figma_template.build_template               |  theme_compiler.compile_svg
        |                                              v
    public/design/<pkg>/<el>.svg  <------------------- shipped theme

WHY A SHIPPED SVG CANNOT JUST BE OPENED IN FIGMA. It is already SVG, so the
temptation is to double-click it and start editing. Four things in the shipped
files are invisible to Figma's importer, and each one fails silently:

  1. ``<style>`` blocks. Figma does not apply stylesheet CSS - only
     presentation attributes and inline ``style=``. Every theme except
     scoreboard-s paints its text through classes (``.st-num { fill: ... }``),
     so a raw import renders the type BLACK in the default face. This is the
     big one: stats.svg has ten text nodes and not one of them carries a fill.
  2. ``var()``. Figma resolves no custom properties, in a stylesheet or inline.
     ``style="fill:var(--band)"`` imports as no fill at all.
  3. Empty ``<image>`` slots. PRSH ships no Nintendo art, so icon slots are
     authored href-less at ``opacity:0``; Figma drops them, and the designer
     never learns the slot exists.
  4. Marker attributes. Figma keeps layer NAMES, not ``data-*`` attributes, so
     a straight import loses every binding on the way back out.

So the template bakes 1-3 flat and rewrites 4 into the layer-name grammar the
compiler already reads (``slot=side1-name maxw=420``). What the designer opens
looks like the live element, and what they export compiles back to it.

WHAT IS DELIBERATELY NOT BAKED. Motion. The mounts own every animation (GSAP
timelines in JS, ``@keyframes`` for the atmosphere fields), and a design tool
cannot author it - so the template drops animation declarations rather than
freezing a pose that would then read as authored geometry. Sprites land at
their rest transform, which is where the mount puts them at t=0. The header
comment written into each template says how many rules were dropped, so the
designer knows motion exists and is not theirs.

HIDDEN STATE is REVEALED. Layers the contract authors at ``opacity:0`` (a FINAL
badge, a runner icon, the completed-game row) are states the app turns on, not
design choices - and a designer cannot style what a design tool draws as
nothing. So the template sets them to full opacity and spells the authored
state in the layer name as the bare flag ``hidden``, which the compiler reads
back into ``opacity="0"``. Revealing them WITHOUT that flag is what would make
the round trip lossy: the layer would compile back permanently visible.

MELD STAGES get dashed guides. A card that resizes at runtime (Scoreboard S
grows sideways for the inning/live segments and downwards for the game-mode
band) can only be ONE of its sizes in a static file, so the shipped SVG shows a
game-mode line sitting outside a card 28 units too short. Every extent the card
can take is drawn as a dashed ``scaffold=stage-*`` box, derived from the same
``compact-w``/``compact-h``/``cardw``/``cardh`` attributes the mount melds to,
so the guides cannot drift from the behaviour.
"""
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from server.theme_compiler import (
    _LIST_MODIFIERS,
    _MODIFIERS,
    _local,
    FileReport,
    SVG_NS,
    XLINK_NS,
)

# Reverse of theme_compiler._MODIFIERS: data-<suffix> -> grammar key. Built from
# that table rather than restated, so a modifier added there cannot go missing
# here. First key wins for aliases (maxw over nothing, cardw over cardw).
_ATTR_TO_GRAMMAR: dict[str, str] = {}
for _key, _suffix in _MODIFIERS.items():
    _ATTR_TO_GRAMMAR.setdefault(f"data-{_suffix}", _key)

# The three runtime SEAM colours. These are not theme choices - the mounts
# repaint them per game from the controller ports and the producer's accent - so
# the template carries a literal sentinel hue the designer can see and place,
# and the compiler maps the sentinel back to the var on the way in. The hues are
# the ones already documented in design-templates/SCOREBOARD-DESIGN-NOTES.md;
# side1 deliberately is NOT the token default (#e60012), because side1 and
# accent resolve to the same red and the round trip has to tell them apart.
SEAM_SENTINELS = {
    "side1": "#E53935",
    "side2": "#1E88E5",
    "accent": "#E60012",
    # callout.svg's backdrop seams (postgame spotlight + game summary)
    "port-color": "#E53935",
    "well": "#2B2B40",
    "accent-neutral": "#8F8FA3",
}

# Text a slot shows in Figma when the shipped file authors it empty. An empty
# <text> is invisible in a design tool, so the designer cannot see - let alone
# style - the slot at all. Values are the LONG realistic case on purpose: a
# slot's fit bound (data-maxw) is only judgeable against content that tests it.
_PLACEHOLDER = {
    "line-label": "LAST",
    "line-text": "2-run HR to left, 3 RBI",
    "s1-name": "Player One",
    "s2-name": "Player Two",
    "side1-name": "Player One",
    "side2-name": "Player Two",
    "bat-name": "Monty Mole",
    "pit-name": "Baby Luigi",
    "meta-main": "Mario Stadium - 9 innings",
    "meta-date": "Aug 16, 2026",
    "phase": "GRAND FINAL RESET",
    "clock": "11:11 AM ET",
    "status": "UP NEXT",
}

_TRANSPARENT_PX = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0"
    "lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

_ANIM_PROPS = re.compile(r"^(animation|transition)(-|$)", re.I)


@dataclass
class TemplateReport(FileReport):
    """Same shape as the compiler's report, so a CLI can print either."""

    slots: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# CSS token resolution
# --------------------------------------------------------------------------

def load_tokens(css_text: str) -> dict[str, str]:
    """Parse ``--name: value`` pairs out of a tokens stylesheet, resolving
    nested ``var()`` references (``--accent: var(--rio-500)`` -> ``#e60012``).
    """
    raw: dict[str, str] = {}
    body = re.sub(r"/\*.*?\*/", "", css_text, flags=re.S)
    for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;}]+)", body):
        raw[m.group(1)] = m.group(2).strip()

    def resolve(name: str, seen: frozenset[str] = frozenset()) -> str:
        if name in seen or name not in raw:
            return ""
        value = raw[name]
        for ref in re.findall(r"var\(\s*(--[\w-]+)", value):
            value = re.sub(
                r"var\(\s*" + re.escape(ref) + r"\s*(?:,[^()]*)?\)",
                resolve(ref, seen | {name}) or "",
                value,
            )
        return value.strip()

    return {name: resolve(name) for name in raw}


def _split_var(value: str, start: int) -> tuple[str, str, int] | None:
    """Scan one ``var(--name, fallback)`` from ``start``; return (name, fallback, end).

    Deliberately a paren-BALANCED scan rather than a regex. A fallback is very
    often itself a function — ``var(--card-bg, rgba(15,15,25,0.88))`` is how the
    whole `classic` token skin is painted — and a ``[^()]*`` fallback group stops
    at the inner ``rgba(``, matches nothing, and leaves the declaration
    untouched. That failure is silent and total: the template keeps the raw
    var(), Figma resolves nothing, and the designer opens a card with no fill.
    """
    open_paren = value.find("(", start)
    if open_paren < 0:
        return None
    depth, i = 1, open_paren + 1
    while i < len(value) and depth:
        if value[i] == "(":
            depth += 1
        elif value[i] == ")":
            depth -= 1
        i += 1
    if depth:
        return None  # unbalanced — leave the value alone
    inner = value[open_paren + 1:i - 1]
    name, _, fallback = inner.partition(",")
    return name.strip(), fallback.strip(), i


def resolve_value(value: str, tokens: dict[str, str]) -> str:
    """Substitute every ``var(--x, fallback)`` in one declaration value.

    Seam vars resolve to their sentinel hue; everything else to the token's own
    value, then to the declaration's own fallback. A TOKEN SKIN (`classic`) is
    painted with the app's Design-tab vars, which live in the app's settings and
    not in the token sheet — its authored fallbacks are the answer there, and
    are the right one: they are the neutral the designer chose for that skin, so
    the template shows the skin unstyled rather than importing a second source
    of truth for Design-tab defaults.
    """
    out, i = value, 0
    while True:
        at = out.find("var(", i)
        if at < 0:
            return out.strip()
        parsed = _split_var(out, at)
        if parsed is None:
            return out.strip()
        name, fallback, end = parsed
        seam = SEAM_SENTINELS.get(name[2:]) if name.startswith("--") else None
        replacement = seam or tokens.get(name) or resolve_value(fallback, tokens)
        out = out[:at] + replacement + out[end:]
        i = at + len(replacement)


def simplify_font(stack: str) -> str:
    """Reduce a CSS font stack to its first family, unquoted.

    Figma binds a text node to ONE font. Handed ``'Rajdhani', 'Arial Narrow',
    sans-serif`` it takes the whole string as a family name, fails to find it,
    and silently substitutes - so every fallback in the stack costs the designer
    the real face. The stacks exist for the browser, which still gets them from
    the shipped file; the template only has to name the face Figma should load.
    """
    first = stack.split(",")[0].strip()
    return first.strip("'\"")


# --------------------------------------------------------------------------
# Minimal CSS matcher (survey of every shipped package: 51 bare `.class`
# selectors and 4 `defs .class` descendants - nothing else is used, and
# anything more exotic is reported rather than guessed at)
# --------------------------------------------------------------------------

def parse_style_rules(css: str) -> tuple[list[tuple[str, str]], int]:
    """Return ([(selector, declarations)], dropped_keyframe_count)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    keyframes = len(re.findall(r"@keyframes", css))
    # Drop @keyframes blocks whole (they nest one level of braces).
    css = re.sub(r"@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}", "", css, flags=re.S)
    rules: list[tuple[str, str]] = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        decls = m.group(2).strip()
        for sel in m.group(1).split(","):
            sel = sel.strip()
            if sel:
                rules.append((sel, decls))
    return rules, keyframes


def _selector_matches(el: ET.Element, sel: str, ancestors: list[ET.Element]) -> bool | None:
    """True/False, or None when the selector is beyond this matcher."""
    parts = sel.split()
    if len(parts) == 2:  # descendant, e.g. `defs .lt-mush`
        anc, own = parts
        if not any(isinstance(a.tag, str) and _local(a.tag) == anc for a in ancestors):
            return False
        sel = own
    elif len(parts) != 1:
        return None
    if sel.startswith("."):
        return sel[1:] in (el.get("class") or "").split()
    if sel.startswith("#"):
        return el.get("id") == sel[1:]
    if re.fullmatch(r"[a-zA-Z]+", sel):
        return isinstance(el.tag, str) and _local(el.tag) == sel
    return None


def _split_decls(decls: str) -> list[tuple[str, str]]:
    out = []
    for d in decls.split(";"):
        if ":" in d:
            prop, _, value = d.partition(":")
            out.append((prop.strip(), value.strip()))
    return out


# --------------------------------------------------------------------------
# Grammar id (inverse of theme_compiler.parse_grammar_id)
# --------------------------------------------------------------------------

def grammar_id(el: ET.Element) -> str | None:
    """Build the ``slot=name maxw=420`` layer name for a marked node."""
    for marker in ("slot", "part", "tpl"):
        name = el.get(f"data-{marker}")
        if name:
            break
    else:
        if el.get("data-band") is None and not any(
            el.get(a) for a in ("data-x", "data-w", "data-h")
        ):
            return None
        marker, name = "band", ""
    tokens = [f"{marker}={name}" if name else marker]
    for attr, key in _ATTR_TO_GRAMMAR.items():
        value = el.get(attr)
        if value is None:
            continue
        # A layer name is split on spaces, so a coordinate list rides on commas.
        if key in _LIST_MODIFIERS:
            value = ",".join(value.split())
        tokens.append(f"{key}={value}")
    # The authored hidden state, carried as a flag so the template can reveal
    # the layer for editing without the reveal shipping (see module docstring).
    if _is_hidden(el):
        tokens.append("hidden")
    return " ".join(tokens)


def _is_hidden(el: ET.Element) -> bool:
    """Is this layer authored invisible? (step 3 has already lifted an inline
    ``style="opacity:0"`` onto the attribute, so the attribute is enough.)"""
    try:
        return float(el.get("opacity", "1")) == 0
    except ValueError:
        return False


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

GUIDE_HUE = "#00E5FF"  # deliberately not a design colour and not a seam sentinel


def _num(el: ET.Element, attr: str) -> float | None:
    try:
        return float(el.get(attr))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _meld_stages(root: ET.Element) -> list[tuple[str, float, float, float, float, str]]:
    """Every extent a melding card takes, as ``(label, x, y, w, h, rx)``.

    Read off the meld attributes themselves — card-bg's collapsed size plus each
    segment's ``data-cardw``/``data-cardh`` — so a guide cannot claim a size the
    mount would not actually grow to. A theme with no meld gets nothing.
    """
    bg = next(
        (el for el in root.iter()
         if isinstance(el.tag, str) and el.get("data-slot") == "card-bg"),
        None,
    )
    if bg is None:
        return []
    compact_w, compact_h = _num(bg, "data-compact-w"), _num(bg, "data-compact-h")
    if compact_w is None and compact_h is None:
        return []

    x, y = _num(bg, "x") or 0.0, _num(bg, "y") or 0.0
    rx = bg.get("rx") or "0"
    widths: list[tuple[str, float]] = []
    heights: list[tuple[str, float]] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        name = el.get("data-slot") or "segment"
        w, h = _num(el, "data-cardw"), _num(el, "data-cardh")
        if w is not None:
            widths.append((name, w))
        if h is not None:
            heights.append((name, h))

    # The axis a theme does not meld is fixed at the authored size.
    rest_w = compact_w if compact_w is not None else (_num(bg, "width") or 0.0)
    rest_h = compact_h if compact_h is not None else (_num(bg, "height") or 0.0)
    full_w = max([rest_w] + [w for _, w in widths])

    stages = [("resting", x, y, rest_w, rest_h, rx)]
    # A width stage is drawn at the resting height and a height stage at the
    # full width: the two axes meld independently, so each box is one axis's
    # answer rather than a combined state the card may never be in.
    stages += [(name, x, y, w, rest_h, rx) for name, w in sorted(widths, key=lambda t: t[1])]
    stages += [(name, x, y, full_w, h, rx) for name, h in sorted(heights, key=lambda t: t[1])]
    return stages


# Rows the mount never shows together, so the preview stacks them at ONE offset
# instead of two. A board is showing a live game or a completed one, never both;
# scoreboard-mount.js gates them on showLiveSeg / showFinal, which is logic and
# not something a theme file declares — so the pairing is stated here.
_EXCLUSIVE_ROWS = ({"row-live", "row-final"},)


def _stack_rows(root: ET.Element) -> list[tuple[ET.Element, str, float]]:
    """Every ``row-*`` group of a STACK theme with the y it lands on, in the
    order the mount stacks them (which is document order in every shipped file).

    Absolute themes place their own rows and get nothing. The preview is the
    LIVE state: where two rows are alternates the taller one sets the advance,
    so nothing below can collide in either state and the designer is authoring
    against the card at its full height.
    """
    if (root.get("data-layout") or "stack").lower() != "stack":
        return []
    rows = [
        el for el in root.iter()
        if isinstance(el.tag, str) and (el.get("data-slot") or "").startswith("row-")
    ]
    if not rows:
        return []
    bg = next(
        (el for el in root.iter()
         if isinstance(el.tag, str) and el.get("data-slot") == "card-bg"),
        None,
    )
    out: list[tuple[ET.Element, str, float]] = []
    offset = (_num(bg, "y") if bg is not None else 0.0) or 0.0
    group_at: dict[int, float] = {}
    for el in rows:
        name = el.get("data-slot") or ""
        gi = next((k for k, g in enumerate(_EXCLUSIVE_ROWS) if name in g), None)
        # An alternate of a row already placed sits ON it and advances nothing.
        if gi is not None and gi in group_at:
            out.append((el, name, group_at[gi]))
            continue
        out.append((el, name, offset))
        height = _num(el, "data-h") or 0.0
        if gi is not None:
            group_at[gi] = offset
            height = max(
                (_num(other, "data-h") or 0.0)
                for other in rows if (other.get("data-slot") or "") in _EXCLUSIVE_ROWS[gi]
            )
        offset += height
    return out


def _stage_guides(stages: list[tuple[str, float, float, float, float, str]]) -> ET.Element:
    """The dashed boxes, on TOP of the art — an outline behind an opaque card
    is an outline the designer never sees."""
    def fmt(v: float) -> str:
        return f"{v:g}"

    group = ET.Element(f"{{{SVG_NS}}}g")
    group.set("id", "scaffold=meld-stages")
    group.set("fill", "none")
    group.set("stroke", GUIDE_HUE)
    group.set("stroke-opacity", "0.75")
    group.set("stroke-width", "1")
    group.set("stroke-dasharray", "4 4")
    for i, (label, x, y, w, h, rx) in enumerate(stages):
        rect = ET.SubElement(group, f"{{{SVG_NS}}}rect")
        rect.set("id", f"scaffold=stage-{label}")
        rect.set("x", fmt(x))
        rect.set("y", fmt(y))
        rect.set("width", fmt(w))
        rect.set("height", fmt(h))
        rect.set("rx", rx)
        # Right-aligned to the box's OWN right edge (which is what names it),
        # but stepped down one line per stage: two stages a few units apart
        # would otherwise print their labels over each other.
        text = ET.SubElement(group, f"{{{SVG_NS}}}text")
        text.set("id", f"scaffold=stage-{label}-label")
        text.set("x", fmt(x + w - 5))
        text.set("y", fmt(y + 12 + i * 11))
        text.set("text-anchor", "end")
        text.set("font-family", "Inter")
        text.set("font-size", "9")
        text.set("fill", GUIDE_HUE)
        text.set("fill-opacity", "0.75")
        text.set("stroke", "none")
        text.text = f"{label} {fmt(w)}x{fmt(h)}"
    return group


def build_template(
    svg_text: str,
    element: str,
    tokens: dict[str, str],
    filename: str = "",
) -> tuple[str, TemplateReport]:
    """Turn one shipped theme SVG into its Figma reimport template."""
    report = TemplateReport(file=filename or f"{element}.template.svg", element=element)

    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK_NS)
    try:
        parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
        root = ET.fromstring(svg_text, parser=parser)
    except ET.ParseError as e:
        report.add("error", f"not valid SVG/XML ({e})")
        return svg_text, report

    parent_of = {c: p for p in root.iter() for c in p}

    def tag_of(el: ET.Element) -> str:
        return _local(el.tag) if isinstance(el.tag, str) else ""

    def ancestry(el: ET.Element) -> list[ET.Element]:
        out, cur = [], parent_of.get(el)
        while cur is not None:
            out.append(cur)
            cur = parent_of.get(cur)
        return out

    # --- 1. collect + remove <style> blocks -------------------------------
    rules: list[tuple[str, str]] = []
    keyframes = 0
    for style_el in [e for e in root.iter() if isinstance(e.tag, str) and _local(e.tag) == "style"]:
        r, k = parse_style_rules(style_el.text or "")
        rules += r
        keyframes += k
        parent_of[style_el].remove(style_el)
    if rules:
        report.add("info", f"baked {len(rules)} stylesheet rule(s) onto their nodes")
    if keyframes:
        report.add("info", f"dropped {keyframes} @keyframes block(s) - motion is the mount's, not the theme's")

    # --- 2. apply matched rules as inline style (inline wins) -------------
    unmatched: set[str] = set()
    unsupported: set[str] = set()
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        anc = ancestry(el)
        inherited: list[tuple[str, str]] = []
        for sel, decls in rules:
            hit = _selector_matches(el, sel, anc)
            if hit is None:
                unsupported.add(sel)
            elif hit:
                inherited += _split_decls(decls)
        if not inherited:
            continue
        own = dict(_split_decls(el.get("style") or ""))
        merged = {p: v for p, v in inherited if not _ANIM_PROPS.match(p)}
        merged.update(own)
        el.set("style", ";".join(f"{p}:{v}" for p, v in merged.items()))

    for sel, _ in rules:
        if not any(
            _selector_matches(el, sel, ancestry(el))
            for el in root.iter()
            if isinstance(el.tag, str)
        ):
            unmatched.add(sel)
    if unsupported:
        report.add("warn", f"selector(s) beyond the matcher, dropped: {', '.join(sorted(unsupported))}")
    if unmatched:
        report.add("info", f"selector(s) matched nothing: {', '.join(sorted(unmatched))}")

    # --- 3. resolve var() + strip animation, everywhere ------------------
    seams_hit: set[str] = set()
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        style = el.get("style")
        if style:
            kept = []
            for prop, value in _split_decls(style):
                if _ANIM_PROPS.match(prop):
                    continue
                for name in re.findall(r"var\(\s*(--[\w-]+)", value):
                    if name[2:] in SEAM_SENTINELS:
                        seams_hit.add(name[2:])
                value = resolve_value(value, tokens)
                if prop in ("font-family",):
                    value = simplify_font(value)
                if value:
                    kept.append((prop, value))
            # Figma reads presentation attributes more reliably than inline
            # style for paint, and an attribute is what the designer's own
            # export will emit anyway - so land these as attributes and keep
            # style only for what has no attribute form.
            leftover = []
            for prop, value in kept:
                if prop in _PRESENTATION_ATTRS:
                    el.set(prop, value)
                else:
                    leftover.append((prop, value))
            if leftover:
                el.set("style", ";".join(f"{p}:{v}" for p, v in leftover))
            else:
                el.attrib.pop("style", None)
        for attr in list(el.attrib):
            value = el.get(attr) or ""
            if "var(" in value:
                for name in re.findall(r"var\(\s*(--[\w-]+)", value):
                    if name[2:] in SEAM_SENTINELS:
                        seams_hit.add(name[2:])
                el.set(attr, resolve_value(value, tokens))
            if attr == "font-family":
                el.set(attr, simplify_font(el.get(attr) or ""))
        el.attrib.pop("class", None)
    if seams_hit:
        report.add("info", f"seam colour(s) pinned to sentinels: {', '.join(sorted(seams_hit))}")

    # --- 4. image slots: give Figma something to keep --------------------
    images = 0
    for el in list(root.iter()):
        if tag_of(el) != "image":
            continue
        href = el.get("href") or el.get(f"{{{XLINK_NS}}}href")
        if not href:
            el.set("href", _TRANSPARENT_PX)
        name = el.get("data-slot") or ""
        parent = parent_of.get(el)
        if parent is None or not name:
            continue
        guide = ET.Element(f"{{{SVG_NS}}}rect")
        guide.set("id", f"scaffold={name}")
        for attr in ("x", "y", "width", "height"):
            if el.get(attr):
                guide.set(attr, el.get(attr))
        guide.set("rx", "6")
        guide.set("fill", "#FFFFFF")
        guide.set("fill-opacity", "0.06")
        guide.set("stroke", "#8F8FA3")
        guide.set("stroke-opacity", "0.4")
        guide.set("stroke-dasharray", "3 3")
        parent.insert(list(parent).index(el), guide)
        images += 1
    if images:
        report.add("info", f"added {images} dashed scaffold box(es) behind image slot(s)")

    # --- 4b. meld stages: dashed guides for a card that resizes ----------
    stages = _meld_stages(root)
    if stages:
        root.append(_stage_guides(stages))
        report.add(
            "info",
            f"added {len(stages)} dashed meld-stage guide(s) — the card's runtime extents",
        )

    # --- 4c. stack rows: place them where the mount will -----------------
    # Without this every row of a stack theme sits at y=0, so the designer opens
    # scoreboard-l and finds five bands piled on the frame origin — the card
    # they are supposed to be designing is nowhere in the file. `at=K` records
    # the placement so compile_svg can put the local origins back.
    stack = _stack_rows(root)
    if stack:
        for el, _name, y in stack:
            if y:
                el.set("transform", f"translate(0,{y:g})")
            el.set("data-at", f"{y:g}")
        report.add(
            "info",
            f"placed {len(stack)} stack row(s) at the offsets the mount stacks them to",
        )
        bg = next(
            (el for el in root.iter()
             if isinstance(el.tag, str) and el.get("data-slot") == "card-bg"),
            None,
        )
        top = (_num(bg, "y") if bg is not None else 0.0) or 0.0
        # The BOTTOM-most row, which is not the last in document order once two
        # alternates share an offset.
        total = max(y + (_num(el, "data-h") or 0.0) for el, _n, y in stack) - top
        authored = _num(bg, "height") if bg is not None else None
        if authored is not None and abs(authored - total) > 0.5:
            report.add(
                "warn",
                f"card-bg is {authored:g} tall but the rows stack to {total:g} — the preview "
                "card will not enclose them (the mount sizes the card to the rows)",
            )

    # --- 5. placeholder text so an empty slot is visible -----------------
    filled = 0
    for el in root.iter():
        if tag_of(el) != "text":
            continue
        name = el.get("data-slot")
        if not name or (el.text or "").strip():
            continue
        el.text = _PLACEHOLDER.get(name, name.replace("-", " ").title())
        filled += 1
    if filled:
        report.add("info", f"filled {filled} empty text slot(s) with sample content")

    # --- 6. data-* markers -> layer names --------------------------------
    slots: list[str] = []
    revealed = 0
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        gid = grammar_id(el)
        if not gid:
            continue
        el.set("id", gid)
        # grammar_id has just recorded the authored state as `hidden`, so the
        # layer can now be shown at full strength for editing.
        if _is_hidden(el):
            el.set("opacity", "1")
            revealed += 1
        if el.get("data-slot"):
            slots.append(el.get("data-slot") or "")
        for attr in [a for a in el.attrib if a.startswith("data-")]:
            del el.attrib[attr]
    report.slots = slots
    report.add("info", f"rewrote {len(slots)} slot marker(s) into layer names")
    if revealed:
        report.add(
            "info",
            f"revealed {revealed} layer(s) authored at opacity 0 — tagged `hidden`, "
            "which the compiler restores",
        )

    # The root's own data-layout has no layer to carry it through Figma, so it
    # rides as a marker layer (the compiler lifts it back and drops the layer).
    mode = root.get("data-layout")
    if mode:
        marker = ET.Element(f"{{{SVG_NS}}}rect")
        marker.set("id", f"layout={mode}")
        marker.set("x", "0")
        marker.set("y", "0")
        marker.set("width", "1")
        marker.set("height", "1")
        marker.set("opacity", "0")
        root.insert(0, marker)

    header = ET.Comment(_header(element, root.get("viewBox") or "", keyframes))
    root.insert(0, header)

    report.changed = True
    return ET.tostring(root, encoding="unicode"), report


_PRESENTATION_ATTRS = {
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity",
    "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
    "text-anchor", "stop-color", "stop-opacity",
}


def _header(element: str, viewbox: str, keyframes: int) -> str:
    size = " ".join(viewbox.split()[2:]) if viewbox else "?"
    motion = (
        f"Motion: {keyframes} keyframe block(s) were dropped. Every animation in "
        "PRSH belongs to\n    the mount (JS), not to the theme, so nothing here is "
        "yours to time. Sprites sit\n    at their rest pose."
        if keyframes
        else "Motion lives in the mount (JS), never in the theme file."
    )
    return f"""
    FIGMA REIMPORT TEMPLATE - {element} ({size.replace(' ', 'x')}). GENERATED by
    scripts/figma-template.py from the shipped public/design/default/{element}.svg.
    Do not hand-edit this file; edit it in Figma, or regenerate it.

    Round trip: import this into Figma, restyle, export as SVG (layer names as
    ids, text NOT outlined, frame kept at exactly {size.replace(' ', 'x')}), then run
    scripts/compile-theme.py on the export to get an installable theme back.

    LAYER NAMES ARE THE CONTRACT. Figma keeps names, not attributes, so every
    binding the app needs rides in the layer name:
      slot=NAME            a data slot the app fills
      slot=NAME maxw=N     text that auto shrinks past N units
      part=NAME            a styling part the mount recolours
      tpl=NAME w=N         a prototype the mount clones per row
      slot=NAME hidden     a layer the APP toggles on (a FINAL badge, a runner
                           icon). Shown here so you can style it; the compiler
                           puts it back to invisible. Drop the flag and it
                           ships permanently visible.
      scaffold=NAME        editing only guide (dashed boxes), STRIPPED on compile
      layout=absolute      invisible marker carrying the root layout mode
    Keep them. Rename freely otherwise.

    RUNTIME SEAM COLOURS keep these literal hues on their layers; the compiler
    maps them back to live vars, so they repaint per controller port and per the
    producer's accent setting:
      #E53935 = side 1    #1E88E5 = side 2    #E60012 = producer accent
    Every other colour here is a fixed part of the look and is yours.

    {motion}

    Dashed boxes mark image slots (team logos, character icons). PRSH ships no
    game art, so design the BOX as the no art look; the app draws the real icon
    on top and hides it when there is none.

    STACK ROWS (slot=row-*) have been moved to the offsets the app stacks them
    to, so this file shows the assembled card rather than every band piled on
    the frame origin. `at=N` in the name records where each was put and the
    compiler takes it back out; anything you move ON TOP of that is kept. Two
    rows sharing one `at=` are ALTERNATES - a live game or a completed one,
    never both - so they are drawn overlapping on purpose. Toggle one off in
    the layers panel to work on the other, and design each to fill the band.

    CYAN DASHED BOXES (scaffold=stage-*) are the sizes this card takes at
    runtime, labelled with the row that triggers each. The card GROWS to enclose
    a segment when the app shows it, so content sitting outside the resting box
    is not misplaced - it belongs to a larger stage. Design every stage to look
    finished, and keep each stage's content inside its own box. The guides are
    editing only and never ship.
    """


def default_tokens() -> dict[str, str]:
    css = Path("public/layout/lib/rio-theme/tokens.css")
    return load_tokens(css.read_text()) if css.exists() else {}
