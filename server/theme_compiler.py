"""The theme compiler — turn a designer's SVG export into a conforming theme.

Design tools can't author the ``data-slot``/``data-part``/``data-tpl`` markers
the svg-theme-engine binds to, but they all export **layer names as ids**. The
compiler translates a layer-naming grammar into those markers, normalizes
known export quirks, and lints the result against the element's contract
(server/theme_contracts.py), producing the report the Design-tab install
dialog shows. Designer-facing grammar doc: public/design/DESIGNER-GUIDE.md.

The grammar (one layer name = one marker + optional modifiers):

    slot=side1-name maxw=420      ->  data-slot="side1-name" data-maxw="420"
    part=away-cap                 ->  data-part="away-cap"
    tpl=match w=620               ->  data-tpl="match" data-w="620"  (moved into <defs>)
    band x=210 w=1500 h=170 gap=24 align=center
                                  ->  data-band="" data-x="210" ...

- ``:`` works in place of ``=`` (some tools mangle ``=``); tokens split on
  spaces or underscores (Figma turns spaces into ``_`` in exported ids).
- Names are lowercased; valid names match ``[a-z0-9][a-z0-9-]*``.
- Conforming (hand-authored) files pass through byte-identical: every
  transform is a no-op when there is nothing to do, and lint still runs.

Normalizations applied (each one is reported):
- root ``width``/``height`` stripped (size must come from the viewBox)
- ``preserveAspectRatio`` filled in from the contract when absent
- ``var()`` in presentation attributes (fill/stroke/stop-color/color) moved
  into inline ``style`` — as an attribute it silently does nothing
- ``data-tpl`` groups relocated into ``<defs>``
- ``--`` inside XML comments defused (it breaks the parser)
- manifest ``"palette": "app"`` sets ``data-design-vars="app"`` on the root
- a ``layout=absolute`` (or ``layout=stack``) marker layer lifts to the root as
  ``data-layout`` and is dropped (design tools can't set root attributes)

Used by design_packages.install_zip (every installed zip) and by the CLI
``scripts/compile-theme.py`` (designer/agent iteration). A compiler failure
must never block an install — callers wrap it and fall back to the raw file.
"""
import difflib
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from server.theme_contracts import CONTRACTS, Contract

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

_MARKERS = ("slot", "part", "tpl")
# modifier key (grammar) -> attribute suffix (data-<suffix>)
_MODIFIERS = {
    "maxw": "maxw", "w": "w", "h": "h", "x": "x", "y": "y",
    "gap": "gap", "pad": "pad", "vw": "vw", "align": "align",
    "hfull": "h-full", "h-full": "h-full",
    "hcompact": "h-compact", "h-compact": "h-compact",
}
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_LAYOUT_MARKER_RE = re.compile(r"^layout[=:_ ]+(absolute|stack)$", re.I)
_VAR_ATTRS = ("fill", "stroke", "stop-color", "color")


@dataclass
class Finding:
    level: str  # error | warn | info
    message: str


@dataclass
class FileReport:
    file: str
    element: str | None
    changed: bool = False
    bound: int | None = None    # slots bound / total, when the contract has them
    total: int | None = None
    findings: list[Finding] = field(default_factory=list)

    def add(self, level: str, message: str) -> None:
        self.findings.append(Finding(level, message))

    def to_dict(self) -> dict:
        return {
            "file": self.file,
            "element": self.element,
            "changed": self.changed,
            "bound": self.bound,
            "total": self.total,
            "findings": [{"level": f.level, "message": f.message} for f in self.findings],
        }


def parse_grammar_id(raw: str) -> tuple[str, str, dict[str, str], list[str]] | None:
    """Parse a grammar id into (marker, name, data_attrs, problems), or None.

    None means "not a grammar id at all" — an ordinary designer id, left
    alone. A recognized marker with problems still returns, so the caller can
    report them.
    """
    tokens = [t for t in re.split(r"[ _]+", raw.strip()) if t]
    if not tokens:
        return None
    problems: list[str] = []
    first = tokens[0]
    m = re.match(r"^(slot|part|tpl)[=:](.*)$", first, re.I)
    if m:
        marker = m.group(1).lower()
        name = m.group(2).strip().lower()
        if not _NAME_RE.match(name):
            problems.append(f"invalid {marker} name {name!r} (use lowercase letters, digits, dashes)")
            name = ""
        mods = tokens[1:]
    elif first.lower() == "band" and len(tokens) > 1:
        # bare "band" with no modifiers is treated as an ordinary layer name —
        # the lowerthird band container always needs x/w/h anyway
        marker, name, mods = "band", "", tokens[1:]
    else:
        return None

    attrs: dict[str, str] = {}
    for tok in mods:
        km = re.match(r"^([a-zA-Z-]+)[=:](.+)$", tok)
        if not km:
            problems.append(f"unrecognized modifier {tok!r}")
            continue
        key, value = km.group(1).lower(), km.group(2)
        suffix = _MODIFIERS.get(key)
        if suffix is None:
            problems.append(f"unknown modifier {key!r}")
            continue
        attrs[f"data-{suffix}"] = value
    return marker, name, attrs, problems


def _defuse_comments(text: str) -> tuple[str, bool]:
    """Replace `--` inside XML comments (invalid XML; a classic authored-note bug)."""
    changed = False

    def fix(m: re.Match) -> str:
        nonlocal changed
        inner = m.group(1)
        if "--" in inner:
            changed = True
            inner = inner.replace("--", "- -")
        return f"<!--{inner}-->"

    return re.sub(r"<!--(.*?)-->", fix, text, flags=re.S), changed


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text_of(el: ET.Element) -> str:
    return " ".join("".join(el.itertext()).split())


def _style_props(style: str) -> set[str]:
    return {p.split(":", 1)[0].strip().lower() for p in style.split(";") if ":" in p}


def compile_svg(
    svg_text: str,
    element: str | None,
    filename: str = "",
    palette: str | None = None,
) -> tuple[str, FileReport]:
    """Compile one theme SVG. Returns (output_text, report).

    Output is byte-identical to the input when nothing needed changing.
    ``element`` keys the contract lookup (usually the filename stem);
    ``palette="app"`` opts the theme into the Design-tab CSS vars.
    """
    report = FileReport(file=filename or f"{element}.svg", element=element)
    contract: Contract | None = CONTRACTS.get(element or "")
    if contract is None:
        report.add("info", f"no contract for element '{element}' — grammar translated, lint skipped")

    mutations = 0
    text, defused = _defuse_comments(svg_text)
    if defused:
        report.add("info", "fixed '--' inside an XML comment (invalid XML)")
        mutations += 1

    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK_NS)
    try:
        parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
        root = ET.fromstring(text, parser=parser)
    except ET.ParseError as e:
        report.add("error", f"not valid SVG/XML ({e}) — installed as-is")
        return svg_text, report

    if _local(root.tag) != "svg":
        report.add("error", "root element is not <svg> — installed as-is")
        return svg_text, report

    parent_of = {child: parent for parent in root.iter() for child in parent}

    # --- root normalization ---
    stripped_dims = [d for d in ("width", "height") if root.get(d) is not None]
    for dim in stripped_dims:
        del root.attrib[dim]
        mutations += 1
    if stripped_dims:
        report.add("info", "stripped fixed width/height from the root (size comes from the viewBox)")

    vb = root.get("viewBox")
    if not vb:
        report.add("warn", "root <svg> has no viewBox — the theme cannot scale")
    elif contract:
        try:
            _, _, w, h = (float(v) for v in vb.replace(",", " ").split())
            if (round(w), round(h)) != contract.canvas:
                report.add(
                    "warn",
                    f"canvas is {w:g}x{h:g}, this element is authored at "
                    f"{contract.canvas[0]}x{contract.canvas[1]} — it will be fit, not fill",
                )
        except ValueError:
            report.add("warn", f"unparseable viewBox {vb!r}")

    if contract and not root.get("preserveAspectRatio"):
        root.set("preserveAspectRatio", contract.preserve_aspect_ratio)
        report.add("info", f'set preserveAspectRatio="{contract.preserve_aspect_ratio}" (contract default)')
        mutations += 1
    elif contract and root.get("preserveAspectRatio") != contract.preserve_aspect_ratio:
        report.add(
            "warn",
            f'preserveAspectRatio is "{root.get("preserveAspectRatio")}" — the contract expects '
            f'"{contract.preserve_aspect_ratio}" (kept yours; make sure it is intentional)',
        )

    if palette == "app" and root.get("data-design-vars") != "app":
        root.set("data-design-vars", "app")
        report.add("info", 'set data-design-vars="app" (token-skin palette, from the manifest)')
        mutations += 1

    # --- layout mode: a `layout=absolute` (or `layout=stack`) marker layer lifts
    # to the root as data-layout and is dropped. Lets a design tool declare the
    # mode with a named layer, since it can't set attributes on the root <svg>. ---
    layout_markers = [
        el for el in root.iter()
        if isinstance(el.tag, str) and el.get("id")
        and _LAYOUT_MARKER_RE.match(el.get("id").strip())
    ]
    if layout_markers:
        mode = _LAYOUT_MARKER_RE.match(layout_markers[0].get("id").strip()).group(1).lower()
        if root.get("data-layout") is None:
            root.set("data-layout", mode)
            report.add("info", f'set data-layout="{mode}" on the root (from a layout marker layer)')
        for el in layout_markers:
            if el in parent_of:
                parent_of[el].remove(el)
        mutations += 1

    # --- grammar translation ---
    translated = 0
    grammar_problems: list[str] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue  # comments
        raw_id = el.get("id")
        if not raw_id:
            continue
        parsed = parse_grammar_id(raw_id)
        if parsed is None:
            continue
        marker, name, attrs, problems = parsed
        grammar_problems.extend(f"id {raw_id!r}: {p}" for p in problems)
        if marker != "band" and not name:
            continue
        key = "data-band" if marker == "band" else f"data-{marker}"
        value = "" if marker == "band" else name
        if el.get(key) is None:
            el.set(key, value)
            mutations += 1
            translated += 1
        elif el.get(key) != value:
            report.add("info", f"id {raw_id!r} ignored — element already has {key}=\"{el.get(key)}\"")
        for k, v in attrs.items():
            if el.get(k) is None:
                el.set(k, v)
                mutations += 1
    if translated:
        report.add("info", f"translated {translated} grammar id(s) into data-* markers")
    for p in grammar_problems:
        report.add("warn", p)

    # --- var() in presentation attributes -> inline style ---
    moved_vars = 0
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        for attr in _VAR_ATTRS:
            val = el.get(attr)
            if val and "var(" in val:
                style = el.get("style") or ""
                if attr not in _style_props(style):
                    style = (style.rstrip().rstrip(";") + "; " if style.strip() else "") + f"{attr}:{val}"
                    el.set("style", style)
                del el.attrib[attr]
                moved_vars += 1
                mutations += 1
    if moved_vars:
        report.add("info", f"moved {moved_vars} var() paint(s) into inline style (as attributes they silently do nothing)")

    # --- relocate data-tpl groups into <defs> ---
    defs = next((c for c in root if isinstance(c.tag, str) and _local(c.tag) == "defs"), None)
    to_move = []
    for el in root.iter():
        if isinstance(el.tag, str) and el.get("data-tpl") is not None:
            anc, in_defs = parent_of.get(el), False
            while anc is not None:
                if isinstance(anc.tag, str) and _local(anc.tag) == "defs":
                    in_defs = True
                    break
                anc = parent_of.get(anc)
            if not in_defs:
                to_move.append(el)
    for el in to_move:
        if defs is None:
            defs = ET.Element(f"{{{SVG_NS}}}defs")
            root.insert(0, defs)
        parent_of[el].remove(el)
        defs.append(el)
        mutations += 1
    if to_move:
        report.add("info", f"moved {len(to_move)} template group(s) (data-tpl) into <defs>")

    # --- lint against the contract ---
    if contract is not None and contract.slots is not None:
        _lint(root, contract, report)

    out = ET.tostring(root, encoding="unicode") if mutations else svg_text
    report.changed = bool(mutations)
    return out, report


def _lint(root: ET.Element, contract: Contract, report: FileReport) -> None:
    found_slots: dict[str, ET.Element] = {}
    found_parts: dict[str, ET.Element] = {}
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        if el.get("data-slot"):
            found_slots.setdefault(el.get("data-slot"), el)
        if el.get("data-part"):
            found_parts.setdefault(el.get("data-part"), el)

    if contract.slots == {}:  # backdrop element: slots are ignored by design
        report.bound, report.total = 0, 0
        if found_slots:
            report.add("warn", f"{contract.note or 'this element takes no data slots'} "
                               f"— found: {', '.join(sorted(found_slots))}")
        return

    known = contract.slots
    bound = [n for n in found_slots if n in known]
    report.bound, report.total = len(bound), len(known)

    missing_required = sorted(n for n, s in known.items() if s.required and n not in found_slots)
    if missing_required:
        report.add("warn", f"missing required slot(s): {', '.join(missing_required)} — these stay empty on stream")

    for name in sorted(set(found_slots) - set(known)):
        hint = difflib.get_close_matches(name, list(known), n=1)
        suffix = f" — did you mean '{hint[0]}'?" if hint else ""
        report.add("warn", f"unknown slot '{name}' (the mount will never bind it){suffix}")

    for name, el in sorted(found_slots.items()):
        spec = known.get(name)
        expected_tag = {"group": "g"}.get(spec.kind, spec.kind) if spec else None
        if spec and spec.kind != "any" and _local(el.tag) != expected_tag:
            extra = " — was the text outlined on export?" if spec.kind == "text" else ""
            report.add("warn", f"slot '{name}' is on <{_local(el.tag)}> but should be <{expected_tag}>{extra}")

    if contract.parts:
        for name in sorted(set(found_parts) - set(contract.parts)):
            hint = difflib.get_close_matches(name, list(contract.parts), n=1)
            suffix = f" — did you mean '{hint[0]}'?" if hint else ""
            report.add("warn", f"unknown part '{name}'{suffix}")
        missing_parts = sorted(n for n, s in contract.parts.items() if s.required and n not in found_parts)
        if missing_parts:
            report.add("warn", f"missing required part(s): {', '.join(missing_parts)}")

    # Unbound text inventory — decorative text is fine; this catches the slot
    # the designer drew but forgot to name.
    unbound = []
    for el in root.iter():
        if isinstance(el.tag, str) and _local(el.tag) == "text" \
                and not el.get("data-slot") and not el.get("data-part"):
            t = _text_of(el)
            if t:
                unbound.append(t if len(t) <= 30 else t[:27] + "...")
    if unbound:
        shown = ", ".join(f'"{t}"' for t in unbound[:8])
        more = f" (+{len(unbound) - 8} more)" if len(unbound) > 8 else ""
        report.add("info", f"{len(unbound)} unbound <text> element(s) — fine if decorative: {shown}{more}")

    if contract.note and contract.slots != {}:
        report.add("info", contract.note)
