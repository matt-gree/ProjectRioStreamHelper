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

The other deliberate non-change is HIDDEN STATE: layers the contract authors at
``opacity:0`` (a FINAL badge, a runner icon, the completed-game row) stay at
zero. They are still real layers in Figma's panel and can be toggled to edit,
and leaving the authored value is what keeps the round trip lossless - a
revealed layer would compile back as a permanently visible one.
"""
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from server.theme_compiler import _MODIFIERS, _local, FileReport, SVG_NS, XLINK_NS

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
        if value is not None:
            tokens.append(f"{key}={value}")
    return " ".join(tokens)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

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
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        gid = grammar_id(el)
        if not gid:
            continue
        el.set("id", gid)
        if el.get("data-slot"):
            slots.append(el.get("data-slot") or "")
        for attr in [a for a in el.attrib if a.startswith("data-")]:
            del el.attrib[attr]
    report.slots = slots
    report.add("info", f"rewrote {len(slots)} slot marker(s) into layer names")

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
    """


def default_tokens() -> dict[str, str]:
    css = Path("public/layout/lib/rio-theme/tokens.css")
    return load_tokens(css.read_text()) if css.exists() else {}
