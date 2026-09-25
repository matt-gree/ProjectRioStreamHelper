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
import copy
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from server.theme_compiler import (
    _LIST_MODIFIERS,
    _MODIFIERS,
    _local,
    _translate_xy,
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
    "port-2": "#1E88E5",
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
    "side1-score": "2",
    "side2-score": "1",
    "time": "7:15 PM",
    "meta": "Winners Final \u00b7 Bo3",
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
            return _fold_calc(out.strip())
        parsed = _split_var(out, at)
        if parsed is None:
            return _fold_calc(out.strip())
        name, fallback, end = parsed
        seam = SEAM_SENTINELS.get(name[2:]) if name.startswith("--") else None
        replacement = seam or tokens.get(name) or resolve_value(fallback, tokens)
        out = out[:at] + replacement + out[end:]
        i = at + len(replacement)


_CALC_RE = re.compile(r"calc\(([\d.\s*/+()-]+)\)")


def _fold_calc(value: str) -> str:
    """``calc(0.5 * 1)`` -> ``0.5``. Once its vars are resolved a calc is plain
    arithmetic, and a design tool reads the attribute as a number or not at all
    - the callout's dot field came through as ``opacity="calc(0.5 * 1)"``."""
    def fold(m: re.Match) -> str:
        try:
            return f"{eval(m.group(1), {'__builtins__': {}}):g}"  # digits and operators only
        except Exception:
            return m.group(0)
    return _CALC_RE.sub(fold, value)


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
    for marker in ("slot", "part", "tpl", "pattern"):
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
    if el.get("data-defs") is not None:
        tokens.append("defs")
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
    if el.get("data-fillref"):
        tokens.append(f"fill={el.get('data-fillref')}")
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
_EXCLUSIVE_ROWS = (
    {"row-live", "row-final"},
    # The Scorecard's score block is ONE setting (mainMode) with three answers,
    # each a whole block the theme draws (scorecard-mount.js STACK).
    {"el-main", "el-rosters", "el-condensed"},
)

# Stack rows are `row-*` on the Scoreboard and `el-*` on the Scorecard — two
# spellings of one contract (a local-origin group with data-h, stacked in
# document order by the mount).
_STACK_PREFIXES = ("row-", "el-")


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
        if isinstance(el.tag, str) and (el.get("data-slot") or "").startswith(_STACK_PREFIXES)
        and el.get("data-h") is not None
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


# --------------------------------------------------------------------------
# Layout for editing
# --------------------------------------------------------------------------
#
# A theme file is authored for the MOUNT, not for a person: prototypes sit at a
# local origin (or inside <defs>, which a design tool never draws) and are
# cloned into place at runtime, and a block with three alternates draws all
# three on one spot. Opened as-is, the ticker is one card sitting on its RESULTS
# badge, the schedule's row prototype sits on its title, the lower third is an
# empty band, and the Scorecard is three score blocks piled on each other.
#
# So the template lays each out where the designer needs to SEE it:
#
#   * a PROTOTYPE moves to its first runtime slot (`at=X,Y` records where) and
#     dashed-free PREVIEW copies (`scaffold=preview-*`) fill the slots after
#     it at the mount's pitch, so spacing can be judged against real neighbours;
#   * an ALTERNATE (a score block, a completed-game row) moves to a COLUMN of
#     its own beside the native frame, with a preview of the rest of the card
#     restacked around it;
#   * a <defs>-only prototype comes out onto the canvas tagged `defs`.
#
# Previews are copies, not instances: they are stripped on compile and do not
# follow edits. Only the original (the layer with a slot=/tpl= name) is live.

COLUMN_GAP = 80       # native frame -> an alternate's column
ROW_GAP = 60          # native frame -> a spare row beneath it
LABEL_ROOM = 44       # canvas below each region for its caption
FRAME_HUE = "#FF00FF"
TICKER_GAP = 16       # overlays.ticker.tickerGap default (designConstants.js)


@dataclass
class _Layout:
    width: float
    height: float
    jobs: list = field(default_factory=list)      # deferred preview copies
    regions: list = field(default_factory=list)   # (caption, x, y, w, h)
    moved: int = 0

    def grow(self, x2: float, y2: float) -> None:
        self.width = max(self.width, x2)
        self.height = max(self.height, y2)


def _at(x: float, y: float) -> str:
    return f"{y:g}" if not x else f"{x:g},{y:g}"


def _place(el: ET.Element, x: float, y: float) -> None:
    if x or y:
        el.set("transform", f"translate({x:g},{y:g})")
    else:
        el.attrib.pop("transform", None)
    el.set("data-at", _at(x, y))


def _find(root: ET.Element, attr: str, value: str | None = None) -> ET.Element | None:
    for el in root.iter():
        if isinstance(el.tag, str) and el.get(attr) is not None and (value is None or el.get(attr) == value):
            return el
    return None


def _preview(layout: _Layout, parent: ET.Element, source: ET.Element, label: str,
             transform: str | None, mutate=None, **attrs: str) -> None:
    """Queue a preview copy of `source` into `parent`. Built after placeholder
    text is filled, so the copy carries it. `mutate(copy)` runs while the copy
    still has its data-* markers, so it can find parts by name."""
    layout.jobs.append((parent, source, label, transform, mutate, attrs))


def _build_previews(layout: _Layout) -> int:
    for parent, source, label, transform, mutate, attrs in layout.jobs:
        dup = copy.deepcopy(source)
        if mutate:
            mutate(dup)
        for el in dup.iter():
            if not isinstance(el.tag, str):
                continue
            el.attrib.pop("id", None)
            for a in [a for a in el.attrib if a.startswith("data-")]:
                del el.attrib[a]
        if transform:
            dup.set("transform", transform)
        else:
            dup.attrib.pop("transform", None)
        # A prototype is authored dark; its original is revealed for editing,
        # so the preview is too.
        if dup.get("opacity") == "0":
            dup.set("opacity", "1")
        for k, v in attrs.items():
            dup.set(k, v)
        wrap = ET.Element(f"{{{SVG_NS}}}g", {"id": f"scaffold=preview-{label}"})
        wrap.append(dup)
        kids = list(parent)
        parent.insert(kids.index(source) + 1 if source in kids else len(kids), wrap)
    return len(layout.jobs)


# The ticker's cards, as the mount would bind them. The first is the ORIGINAL
# (the layer a designer edits), with names long enough to reach the name's fit
# bound - the icons are authored for that worst case, so a short name would
# leave them looking stranded. The rest are preview copies in the three states
# a card can be in, so the track reads like a real one.
_TICKER_CARDS = [
    {"away": "ChainChompKid", "home": "PiantaPower", "score": ("7", "4"), "meta": "Stars Off \u00b7 Sep 21"},
    {"away": "Toadsworth", "home": "Boo Crew", "score": ("5", "2"), "winner": 1, "meta": "Stars Off \u00b7 Sep 21"},
    {"away": "Kritter", "home": "DryBonesDan", "score": ("1", "6"), "winner": 2, "meta": "Stars On \u00b7 Sep 20"},
    {"away": "MontyMole", "home": "WigglerFan", "meta": "Stars Off"},
]
_LOSER_DIM = "0.45"   # LOSER_DIM, mount-utils.js

# Average advance per character, in ems, for the faces the themes use. Only a
# preview's icon placement rests on it, so near is good enough; the app
# measures the real glyphs.
_EM_PER_CHAR = {"rajdhani": 0.45, "inter": 0.56, "chivo mono": 0.6}


def _text_width(el: ET.Element) -> float:
    family = (el.get("font-family") or "").split(",")[0].strip().strip("'\"").lower()
    size = _num(el, "font-size") or 16.0
    width = len((el.text or "").strip()) * size * _EM_PER_CHAR.get(family, 0.5)
    maxw = _num(el, "data-maxw")
    return min(width, maxw) if maxw else width


def _pin_images(card: ET.Element) -> None:
    """Where applyPinsIn puts each pinned icon: `gap` off the measured outer
    edge of its name. The dashed box behind the icon moves with it."""
    parts = {el.get("data-part"): el for el in card.iter()
             if isinstance(el.tag, str) and el.get("data-part")}
    boxes = {el.get("id"): el for el in card.iter()
             if isinstance(el.tag, str) and (el.get("id") or "").startswith("scaffold=")}
    for name, img in parts.items():
        target = img.get("data-pin-before") or img.get("data-pin-after")
        text = parts.get(target)
        if text is None or _num(text, "x") is None:
            continue
        w, x = _text_width(text), _num(text, "x")
        anchor = text.get("text-anchor") or "start"
        left = x - w if anchor == "end" else x - w / 2 if anchor == "middle" else x
        gap, iw = _num(img, "data-pin-gap") or 0.0, _num(img, "width") or 0.0
        nx = left - gap - iw if img.get("data-pin-before") else left + w + gap
        for el in (img, boxes.get(f"scaffold={name}")):
            if el is not None:
                el.set("x", f"{nx:g}")


def _bind_ticker_card(card: ET.Element, game: dict) -> None:
    """ticker-mount.js's bindCard, over a template copy."""
    parts = {el.get("data-part"): el for el in card.iter()
             if isinstance(el.tag, str) and el.get("data-part")}

    def put(name, **attrs):
        el = parts.get(name)
        if el is None:
            return
        for k, v in attrs.items():
            if k == "text":
                el.text = v
            else:
                el.set(k, v)

    scores = game.get("score")
    winner = game.get("winner")
    put("away-name", text=game["away"])
    put("home-name", text=game["home"])
    put("meta", text=game["meta"])
    put("score-group", opacity="1" if scores else "0")
    put("vs", opacity="0" if scores else "1")
    for side, tag in ((1, "away"), (2, "home")):
        put(f"score-{tag}", text=scores[side - 1] if scores else "", opacity="1" if scores else "0")
        put(f"{tag}-row", opacity=_LOSER_DIM if winner and winner != side else "1")
        put(f"{tag}-win", opacity="1" if winner == side else "0")
    _pin_images(card)


def _plan_ticker(root: ET.Element, parent_of: dict, layout: _Layout) -> None:
    tpl, track = _find(root, "data-slot", "card-template"), _find(root, "data-slot", "track")
    if tpl is None or track is None:
        return
    tx, ty = _translate_xy(track.get("transform")) or (0.0, 0.0)
    w = _num(tpl, "data-w") or 0.0
    vw = _num(track, "data-vw") or w
    pitch = w + TICKER_GAP
    _place(tpl, tx, ty)
    layout.moved += 1
    # The original keeps every part visible for editing; only its text is set.
    first = _TICKER_CARDS[0]
    for el in tpl.iter():
        part = el.get("data-part") if isinstance(el.tag, str) else None
        if part in ("away-name", "home-name", "meta"):
            el.text = {"away-name": first["away"], "home-name": first["home"], "meta": first["meta"]}[part]
        elif part in ("score-away", "score-home"):
            el.text = first["score"][part == "score-home"]
    count = max(1, int((vw + TICKER_GAP) // pitch)) if pitch else 1
    for i in range(1, count):
        game = _TICKER_CARDS[1 + (i - 1) % (len(_TICKER_CARDS) - 1)]
        _preview(layout, parent_of[tpl], tpl, f"card-{i + 1}", f"translate({tx + i * pitch:g},{ty:g})",
                 mutate=lambda card, g=game: _bind_ticker_card(card, g))


def _plan_schedule(root: ET.Element, parent_of: dict, layout: _Layout) -> None:
    tpl, rows = _find(root, "data-slot", "match-template"), _find(root, "data-slot", "rows")
    if tpl is None or rows is None:
        return
    rx, ry = _translate_xy(rows.get("transform")) or (0.0, 0.0)
    pitch = _num(tpl, "data-h") or 82.0
    bg = _find(root, "data-slot", "card-bg")
    # The authored card is a pose for N rows; show exactly that many.
    n = 4
    if bg is not None and _num(bg, "height") and _num(bg, "data-compact-h") is not None:
        n = max(1, round((_num(bg, "height") - _num(bg, "data-compact-h")) / pitch))
    _place(tpl, rx, ry)
    layout.moved += 1
    for i in range(1, n):
        _preview(layout, parent_of[tpl], tpl, f"row-{i + 1}", f"translate({rx:g},{ry + i * pitch:g})")
    overflow = _find(root, "data-slot", "overflow")
    if overflow is not None:
        # Where the mount writes it: one line under the last row.
        _place(overflow, 0, n * pitch + 30 - (_num(overflow, "y") or 0.0))
        layout.moved += 1


def _plan_playerplates(root: ET.Element, parent_of: dict, layout: _Layout) -> None:
    side2 = _find(root, "data-slot", "side2")
    if side2 is None:
        return
    anchors = {}
    for el in root.iter():
        if isinstance(el.tag, str) and _local(el.tag) == "script" and "anchors" in (el.text or ""):
            try:
                anchors = json.loads(el.text).get("anchors", {})
            except ValueError:
                pass
    right = float(anchors.get("right", 0) or 0)
    if right:
        _place(side2, right, 0)
        layout.moved += 1


def _plan_lowerthird(root: ET.Element, parent_of: dict, layout: _Layout) -> None:
    band = _find(root, "data-band")
    defs = next((c for c in root if isinstance(c.tag, str) and _local(c.tag) == "defs"), None)
    if band is None or defs is None:
        return
    tpls = [c for c in defs if isinstance(c.tag, str) and c.get("data-tpl")]
    if not tpls:
        return
    bx, bw = _num(band, "data-x") or 0.0, _num(band, "data-w") or layout.width
    bh, gap = _num(band, "data-h") or 0.0, _num(band, "data-gap") or 32.0
    align = band.get("data-align") or "center"
    _, by = _translate_xy(band.get("transform")) or (0.0, 0.0)

    # Pack the templates into band-wide rows in document order: the first row
    # sits in the band itself, the rest in rows below the frame.
    rows: list[list[ET.Element]] = [[]]
    for t in tpls:
        w = _num(t, "data-w") or 300.0
        used = sum(_num(o, "data-w") or 300.0 for o in rows[-1]) + gap * len(rows[-1])
        if rows[-1] and used + w > bw:
            rows.append([])
        rows[-1].append(t)

    bg = _find(root, "data-slot", "band-bg")
    pad = (_num(bg, "data-pad") or 0.0) if bg is not None else 0.0
    for r, row in enumerate(rows):
        total = sum(_num(t, "data-w") or 300.0 for t in row) + gap * (len(row) - 1)
        x = bx + {"left": 0.0, "right": bw - total}.get(align, (bw - total) / 2)
        y = by if r == 0 else layout.height + ROW_GAP + (r - 1) * (bh + LABEL_ROOM + ROW_GAP)
        if r and bg is not None:
            _preview(layout, parent_of[bg], bg, f"bed-{r + 1}", f"translate(0,{y - by:g})",
                     x=f"{x - pad:g}", width=f"{total + 2 * pad:g}")
        for t in row:
            defs.remove(t)
            root.append(t)
            t.set("data-defs", "1")
            _place(t, x, y)
            layout.moved += 1
            x += (_num(t, "data-w") or 300.0) + gap
    base_h = layout.height
    for r in range(1, len(rows)):
        y = base_h + ROW_GAP + (r - 1) * (bh + LABEL_ROOM + ROW_GAP)
        names = ", ".join(t.get("data-tpl") or "" for t in rows[r])
        layout.regions.append((f"more segment templates: {names}", 0.0, y, layout.width, bh))
        layout.grow(layout.width, y + bh + LABEL_ROOM)


def _plan_alternates(root: ET.Element, parent_of: dict, layout: _Layout, stack: list) -> None:
    """Each alternate after the first gets a column of its own, with the rest of
    the card restacked around it (as a preview) so it is designed in context."""
    if not stack:
        return
    native_w, native_h = layout.width, layout.height
    bg = _find(root, "data-slot", "card-bg")
    top = (_num(bg, "y") if bg is not None else 0.0) or 0.0
    rows = [el for el, _n, _y in stack]
    col = 0
    for group in _EXCLUSIVE_ROWS:
        members = [el for el, name, _y in stack if name in group]
        for alt in members[1:]:
            col += 1
            dx = col * (native_w + COLUMN_GAP)
            offset, placed = top, []
            for el, name, _y in stack:
                if name in group and el is not alt:
                    continue
                placed.append((el, offset))
                offset += _num(el, "data-h") or 0.0
            for el, y in placed:
                if el is alt:
                    _place(alt, dx, y)
                    layout.moved += 1
                else:
                    _preview(layout, parent_of[el], el, f"{alt.get('data-slot')}-{el.get('data-slot')}",
                             f"translate({dx:g},{y:g})")
            # Everything that is not a row (the card, its rail, decoration) in
            # the same column, the card resized to this mode's stack.
            for el in list(root):
                if not isinstance(el.tag, str) or el in rows:
                    continue
                if _local(el.tag) in ("defs", "style", "script", "title", "desc"):
                    continue
                if (el.get("id") or "").startswith("scaffold"):
                    continue
                extra = {}
                if el.get("data-slot") in ("card-bg", "card-rail") and el.get("height"):
                    extra["height"] = f"{offset - top:g}"
                _preview(layout, root, el, f"{alt.get('data-slot')}-{el.get('data-slot') or _local(el.tag)}",
                         f"translate({dx:g},0)", **extra)
            layout.regions.append((f"{alt.get('data-slot')}: alternate to {members[0].get('data-slot')}",
                                   dx, 0.0, native_w, native_h))
            layout.grow(dx + native_w, native_h + LABEL_ROOM)


# --------------------------------------------------------------------------
# Pattern fills
# --------------------------------------------------------------------------
#
# A design tool drops an SVG <pattern> fill on import: the callout's back-wall
# grid and both halftone dot fields opened as nothing. And a pattern lives in
# <defs>, which it never draws, so there was no tile to edit either. So:
#
#   * each pattern's TILE comes out onto the canvas below the frame as a group
#     named `pattern=ID w=W h=H` - the one thing to edit - and the compiler
#     turns that group back into the <pattern>;
#   * each layer it painted keeps its place with `fill=ID` in its name (and no
#     fill, since the reference no longer resolves);
#   * a PREVIEW of the painted field sits beside it, expanded into real shapes,
#     cropped to where its masks let it through and with their fade baked in as
#     opacity - so it reads right whether or not the tool honours masks. Like
#     every preview it is a copy, and does not follow edits to the tile.

_PREVIEW_STEPS = 12   # opacity levels a baked fade is quantised to


def _stops(grad: ET.Element) -> list[tuple[float, float]]:
    out = []
    for st in grad:
        if not isinstance(st.tag, str) or _local(st.tag) != "stop":
            continue
        off = st.get("offset") or "0"
        off = float(off[:-1]) / 100 if off.endswith("%") else float(off)
        color = (st.get("stop-color") or "#ffffff").lstrip("#")
        lum = 1.0
        if re.fullmatch(r"[0-9a-fA-F]{6}", color):
            r, g, b = (int(color[i:i + 2], 16) / 255 for i in (0, 2, 4))
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        out.append((off, lum * float(st.get("stop-opacity") or 1)))
    return sorted(out)


def _at_stop(stops: list[tuple[float, float]], t: float) -> float:
    if not stops:
        return 1.0
    t = min(1.0, max(0.0, t))
    if t <= stops[0][0]:
        return stops[0][1]
    for (o1, v1), (o2, v2) in zip(stops, stops[1:]):
        if t <= o2:
            return v1 if o2 == o1 else v1 + (v2 - v1) * (t - o1) / (o2 - o1)
    return stops[-1][1]


def _frac(v: str | None, default: float) -> float:
    if v is None:
        return default
    return float(v[:-1]) / 100 if v.endswith("%") else float(v)


def _mask_value(mask: ET.Element, ids: dict, x: float, y: float) -> float:
    """How much of a point a luminance mask lets through, for the gradient
    shapes these themes build masks from. Anything it cannot evaluate counts
    as fully open, so a preview errs towards showing too much."""
    acc = 0.0
    for shape in mask:
        if not isinstance(shape.tag, str) or _local(shape.tag) != "rect":
            continue
        rx, ry = _num(shape, "x") or 0.0, _num(shape, "y") or 0.0
        rw, rh = _num(shape, "width") or 0.0, _num(shape, "height") or 0.0
        if not (rw and rh and rx <= x <= rx + rw and ry <= y <= ry + rh):
            continue
        ref = re.match(r"url\(#([^)]+)\)", shape.get("fill") or "")
        grad = ids.get(ref.group(1)) if ref else None
        if grad is None or grad.get("gradientTransform") or grad.get("gradientUnits") == "userSpaceOnUse":
            v = 1.0
        else:
            u, w = (x - rx) / rw, (y - ry) / rh
            if _local(grad.tag) == "linearGradient":
                x1, y1 = _frac(grad.get("x1"), 0), _frac(grad.get("y1"), 0)
                x2, y2 = _frac(grad.get("x2"), 1), _frac(grad.get("y2"), 0)
                dx, dy = x2 - x1, y2 - y1
                t = ((u - x1) * dx + (w - y1) * dy) / ((dx * dx + dy * dy) or 1)
            else:
                cx, cy, r = _frac(grad.get("cx"), .5), _frac(grad.get("cy"), .5), _frac(grad.get("r"), .5)
                t = ((u - cx) ** 2 + (w - cy) ** 2) ** 0.5 / (r or 1)
            v = _at_stop(_stops(grad), t)
        acc = acc + v * (1 - acc)
    return acc


def _tile_shapes(tile: ET.Element) -> list[tuple[str, str, dict]] | None:
    """A tile as (kind, geometry, paint) - circles, and paths spelled in the
    absolute M/L/H/V/Z the themes use. None for anything else."""
    shapes = []
    for el in tile:
        if not isinstance(el.tag, str):
            continue
        tag = _local(el.tag)
        paint = {k: el.get(k) for k in ("fill", "stroke", "stroke-width", "stroke-opacity", "fill-opacity")
                 if el.get(k) is not None}
        if tag == "circle":
            shapes.append(("circle", f"{el.get('cx', '0')},{el.get('cy', '0')},{el.get('r', '0')}", paint))
        elif tag == "path" and re.fullmatch(r"[MLHVZmlhvz\d.\s,-]+", el.get("d") or "") \
                and not re.search(r"[lhvm]", el.get("d") or ""):
            shapes.append(("path", el.get("d") or "", paint))
        else:
            return None
    return shapes


def _shift_path(d: str, dx: float, dy: float) -> str:
    out, cmd, axis = [], "M", 0
    for tok in re.findall(r"[MLHVZ]|-?\d*\.?\d+", d):
        if tok in "MLHVZ":
            cmd, axis = tok, 0
            out.append(tok)
            continue
        v = float(tok)
        if cmd == "H" or (cmd in "ML" and axis % 2 == 0):
            v += dx
        elif cmd == "V" or cmd in "ML":
            v += dy
        axis += 1
        out.append(f"{v:g}")
    return " ".join(out)


def _expand(tile: ET.Element, tw: float, th: float, area: tuple, weight) -> ET.Element | None:
    """The field `tile` paints over `area`, one path per (shape, fade level)."""
    shapes = _tile_shapes(tile)
    if not shapes:
        return None
    ax, ay, aw, ah = area
    buckets: dict[tuple[int, int], list[str]] = {}
    ty = ay - (ay % th)
    while ty < ay + ah:
        tx = ax - (ax % tw)
        while tx < ax + aw:
            level = round(weight(tx + tw / 2, ty + th / 2) * _PREVIEW_STEPS)
            if level > 0:
                for i, (kind, geo, _paint) in enumerate(shapes):
                    if kind == "circle":
                        cx, cy, r = (float(v) for v in geo.split(","))
                        cx, cy = cx + tx, cy + ty
                        seg = f"M{cx - r:g} {cy:g}a{r:g} {r:g} 0 1 0 {2 * r:g} 0a{r:g} {r:g} 0 1 0 {-2 * r:g} 0"
                    else:
                        seg = _shift_path(geo, tx, ty)
                    buckets.setdefault((i, level), []).append(seg)
            tx += tw
        ty += th
    group = ET.Element(f"{{{SVG_NS}}}g")
    for (i, level), segs in sorted(buckets.items()):
        _kind, _geo, paint = shapes[i]
        path = ET.SubElement(group, f"{{{SVG_NS}}}path", {"d": "".join(segs), **paint})
        path.set("opacity", f"{level / _PREVIEW_STEPS:.3g}")
    return group


def _lift_patterns(root: ET.Element, parent_of: dict, layout: _Layout, report) -> None:
    defs = next((c for c in root if isinstance(c.tag, str) and _local(c.tag) == "defs"), None)
    if defs is None:
        return
    ids = {el.get("id"): el for el in root.iter() if isinstance(el.tag, str) and el.get("id")}
    patterns = [p for p in defs if isinstance(p.tag, str) and _local(p.tag) == "pattern"
                and (p.get("patternUnits") == "userSpaceOnUse") and not p.get("patternTransform")]
    users = {}
    for el in root.iter():
        m = re.match(r"url\(#([^)]+)\)", el.get("fill") or "") if isinstance(el.tag, str) else None
        if m and m.group(1) in {p.get("id") for p in patterns}:
            users.setdefault(m.group(1), []).append(el)
    patterns = [p for p in patterns if p.get("id") in users]
    if not patterns:
        return

    native_h = layout.height
    y, x, tallest = native_h + ROW_GAP, 0.0, 0.0
    for pat in patterns:
        pid, tw, th = pat.get("id"), _num(pat, "width") or 0.0, _num(pat, "height") or 0.0
        if not (tw and th):
            continue
        # The field each user paints, BEFORE its fill is taken away.
        for el in users[pid]:
            chain, node = [], el
            while node is not None:
                if node.get("mask"):
                    chain.append(ids.get(re.sub(r"^url\(#|\)$", "", node.get("mask"))))
                node = parent_of.get(node)
            try:
                own = float(el.get("opacity", "1"))
            except ValueError:
                own = 1.0

            def weight(px, py, chain=chain, own=own):
                v = own
                for mask in chain:
                    v *= _mask_value(mask, ids, px, py) if mask is not None else 1.0
                return v

            area = (_num(el, "x") or 0.0, _num(el, "y") or 0.0,
                    _num(el, "width") or layout.width, _num(el, "height") or native_h)
            field = _expand(pat, tw, th, area, weight)
            name = el.get("id") or pid
            el.set("fill", "none")
            if el.get("data-slot") or el.get("data-part") or el.get("data-tpl"):
                el.set("data-fillref", pid)
            else:
                el.set("id", f"{el.get('id')} fill={pid}" if el.get("id") else f"fill={pid}")
            if field is None:
                report.add("warn", f"pattern {pid!r}: its tile has shapes the preview cannot expand")
                continue
            # Beside the OUTERMOST masked ancestor, since the fade is baked in.
            anchor, node = el, parent_of.get(el)
            while node is not None and node is not root:
                if node.get("mask"):
                    anchor = node
                node = parent_of.get(node)
            host = parent_of[anchor]
            field.set("id", f"scaffold=preview-{name}")
            host.insert(list(host).index(anchor) + 1, field)
        # The tile itself, on the canvas below the frame.
        tile = ET.Element(f"{{{SVG_NS}}}g", {"data-pattern": pid, "data-w": f"{tw:g}", "data-h": f"{th:g}"})
        for child in list(pat):
            tile.append(child)
        defs.remove(pat)
        root.append(tile)
        _place(tile, x, y)
        layout.regions.append((f"pattern {pid} {tw:g}x{th:g}", x, y, tw, th))
        tallest = max(tallest, th)
        x += max(tw, 120.0) + 200.0
        layout.moved += 1
    layout.grow(max(layout.width, x), y + tallest + LABEL_ROOM)
    report.add("info", f"lifted {len(patterns)} pattern tile(s) onto the canvas (pattern=ID) and "
                       "previewed the fields they paint")


_PLANS = {
    "ticker": _plan_ticker,
    "schedule": _plan_schedule,
    "playerplates": _plan_playerplates,
    "lowerthird": _plan_lowerthird,
}


def _canvas_guides(layout: _Layout, native_w: float, native_h: float) -> ET.Element:
    """Frame bounds + a caption per region, on top of the art."""
    g = ET.Element(f"{{{SVG_NS}}}g", {"id": "scaffold=canvas-guides"})
    ET.SubElement(g, f"{{{SVG_NS}}}rect", {
        "id": "scaffold=frame-bounds", "x": "0", "y": "0",
        "width": f"{native_w:g}", "height": f"{native_h:g}", "fill": "none",
        "stroke": FRAME_HUE, "stroke-width": "2", "stroke-dasharray": "12 8",
    })
    captions = [(f"FRAME {native_w:g}x{native_h:g}: what ships", 0.0, 0.0, native_w, native_h)]
    for label, x, y, w, h in layout.regions:
        ET.SubElement(g, f"{{{SVG_NS}}}rect", {
            "id": f"scaffold=region-{len(captions)}", "x": f"{x:g}", "y": f"{y:g}",
            "width": f"{w:g}", "height": f"{h:g}", "fill": "none",
            "stroke": "#8F8FA3", "stroke-width": "2", "stroke-dasharray": "12 8",
        })
        captions.append((label, x, y, w, h))
    for i, (label, x, y, _w, h) in enumerate(captions):
        t = ET.SubElement(g, f"{{{SVG_NS}}}text", {
            "id": f"scaffold=caption-{i}", "x": f"{x + 4:g}", "y": f"{y + h + 30:g}",
            "font-family": "Inter", "font-size": "20", "font-weight": "600",
            "fill": FRAME_HUE if i == 0 else "#C9C9D6",
        })
        t.text = label
    return g


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
        # A clone prototype's image is a PART (the ticker's captain icons),
        # and needs the box as much as a top-level slot does.
        name = el.get("data-slot") or el.get("data-part") or ""
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
        # Into card-bg's own parent: the stages are in its coordinates, and a
        # card inside a translated group (the schedule's) would otherwise get
        # its guides drawn at the canvas origin.
        bg = _find(root, "data-slot", "card-bg")
        (parent_of.get(bg, root) if bg is not None else root).append(_stage_guides(stages))
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

    # --- 4d. layout for editing: prototypes, alternates, <defs> -----------
    try:
        _, _, native_w, native_h = (float(v) for v in (root.get("viewBox") or "").replace(",", " ").split())
    except ValueError:
        native_w = native_h = 0.0
    layout = _Layout(native_w, native_h)
    plan = _PLANS.get(element)
    if plan and native_w:
        plan(root, parent_of, layout)
    if native_w:
        _plan_alternates(root, parent_of, layout, stack)
        _lift_patterns(root, parent_of, layout, report)
    if layout.moved:
        report.add("info", f"placed {layout.moved} prototype/alternate layer(s) where the app draws them")

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

    # --- 5b. preview copies, now that they can carry the placeholder text --
    previews = _build_previews(layout)
    if previews:
        report.add("info", f"added {previews} preview copy(ies) (scaffold=preview-*, never shipped)")
    extended = layout.width > native_w or layout.height > native_h
    if extended:
        layout.grow(layout.width, native_h + LABEL_ROOM)
        root.append(_canvas_guides(layout, native_w, native_h))
        root.set("viewBox", f"0 0 {layout.width:g} {layout.height:g}")
        report.add(
            "info",
            f"canvas widened to {layout.width:g}x{layout.height:g} around the "
            f"{native_w:g}x{native_h:g} frame (frame= marker restores it)",
        )

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

    if extended:
        root.insert(0, ET.Element(f"{{{SVG_NS}}}rect", {
            "id": f"frame={native_w:g}x{native_h:g}", "x": "0", "y": "0",
            "width": "1", "height": "1", "opacity": "0",
        }))

    header = ET.Comment(_header(element, f"0 0 {native_w:g} {native_h:g}", keyframes, extended))
    root.insert(0, header)

    report.changed = True
    return ET.tostring(root, encoding="unicode"), report


_PRESENTATION_ATTRS = {
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity",
    "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
    "text-anchor", "stop-color", "stop-opacity",
}


def _header(element: str, viewbox: str, keyframes: int, extended: bool = False) -> str:
    size = " ".join(viewbox.split()[2:]) if viewbox else "?"
    motion = (
        f"Motion: {keyframes} keyframe block(s) were dropped. Every animation in "
        "PRSH belongs to\n    the mount (JS), not to the theme, so nothing here is "
        "yours to time. Sprites sit\n    at their rest pose."
        if keyframes
        else "Motion lives in the mount (JS), never in the theme file."
    )
    canvas = (
        f"\n    THE CANVAS IS BIGGER THAN THE ELEMENT. The magenta dashed box is the\n"
        f"    {size.replace(' ', 'x')} frame that ships; the columns/rows beside it hold\n"
        f"    alternates and spare prototypes laid out so nothing overlaps. Leave\n"
        f"    the canvas size alone - the frame= layer tells the compiler the real one.\n"
        if extended else ""
    )
    return f"""
    FIGMA REIMPORT TEMPLATE - {element} ({size.replace(' ', 'x')}). GENERATED by
    scripts/figma-template.py from the shipped public/design/default/{element}.svg.
    Do not hand-edit this file; edit it in Figma, or regenerate it.

    Round trip: import this into Figma, restyle, export as SVG (layer names as
    ids, text NOT outlined, the whole canvas exported as-is), then run
    scripts/compile-theme.py on the export to get an installable theme back.
    {canvas}

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
      frame=WxH            invisible marker: the element's native size
      at=X,Y               where this file PLACED a layer for editing; the
                           compiler takes it back out (a nudge on top is kept)
      defs                 a prototype the app keeps in <defs>; lifted onto the
                           canvas so you can see it, put back on compile
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

    PREVIEW COPIES (scaffold=preview-*) show the slots a prototype is cloned
    into at runtime (ticker cards, schedule rows) and the rest of the card
    around an alternate. They are COPIES: they do not follow your edits and are
    stripped on compile. Edit the original (the slot=/tpl= layer) and check
    the spacing against the copies.

    STACK ROWS (slot=row-* / slot=el-*) have been moved to the offsets the app stacks them
    to, so this file shows the assembled card rather than every band piled on
    the frame origin. `at=N` in the name records where each was put and the
    compiler takes it back out; anything you move ON TOP of that is kept.
    ALTERNATES - rows the app never shows together (a live game or a completed
    one; the Scorecard's full / rosters / condensed score block) - each get a
    column of their own beside the frame, with the rest of the card previewed
    around them. Design each to fill the same band.

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
