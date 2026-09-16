"""Machine-readable theme contracts — what each design-package SVG may declare.

The human-readable contracts live in public/design/README.md; this module is
the subset the theme compiler (server/theme_compiler.py) can lint against:
canvas size, preserveAspectRatio, and (where transcribed) the slot/part
inventory with required flags and expected node kinds.

Contract fidelity is allowed to grow element-by-element: an entry with
``slots=None`` means "canvas checks only, slot lint not transcribed yet" — the
compiler still translates grammar ids for those files. Keep this module in
sync with public/design/README.md and the mounts; when a mount gains or drops
a slot, update the table here in the same change.
"""
from dataclasses import dataclass, field


# Expected node kind for a slot. "any" skips the tag check.
#   text  -> <text>   (the engine sets textContent; a <path> here means the
#                      design tool outlined the text on export)
#   image -> <image>
#   group -> <g>
#   rect  -> <rect>
KINDS = ("text", "image", "group", "rect", "any")


@dataclass(frozen=True)
class Slot:
    kind: str = "any"
    required: bool = False


@dataclass(frozen=True)
class Contract:
    canvas: tuple[int, int]
    preserve_aspect_ratio: str
    # Other canvases this element's mount handles without complaint. Only the
    # bottom-anchored band elements have one: their layout is the height of the
    # card, and the mount pins whatever box the theme declares to the BOTTOM of
    # the source and crops the overflow, so a theme authored on the old full
    # 1920x1080 canvas still lands correctly instead of being scaled to fit.
    # Not a general escape hatch — an element whose mount does not crop should
    # leave this empty so the size mismatch keeps warning.
    alt_canvases: tuple[tuple[int, int], ...] = ()
    # data-slot name -> Slot. None = slot lint not transcribed for this element.
    # {} = the element takes NO data slots (callout is a pure backdrop).
    slots: dict[str, Slot] | None = None
    # data-part name -> Slot (parts live inside slot groups/templates).
    parts: dict[str, Slot] = field(default_factory=dict)
    note: str = ""


def _matchup_slots() -> dict[str, Slot]:
    # Authoritative inventory: the SLOT CONTRACT header + bindings in
    # public/layout/lib/matchup-mount.js (broader than the original README table).
    s: dict[str, Slot] = {
        "logo": Slot("image"),
        "logo-default": Slot("any"),
        "event-name": Slot("text"),
        "subtitle": Slot("text"),
        "side1-name": Slot("text", required=True),
        "side2-name": Slot("text", required=True),
        "side1-sprite": Slot("image"),
        "side2-sprite": Slot("image"),
        "side1-seed": Slot("text"),
        "side2-seed": Slot("text"),
        "side1-wins": Slot("text", required=True),
        "side2-wins": Slot("text", required=True),
        "total-games": Slot("text", required=True),
        # no-shared-history collapse: the cards wrapper hides and the compact
        # band background swaps in for the full one (all optional)
        "history": Slot("any"),
        "history-container": Slot("any"),
        "band-full": Slot("any"),
        "band-compact": Slot("any"),
    }
    for i in range(1, 6):
        s[f"game{i}"] = Slot("group")
        s[f"game{i}-side1-logo"] = Slot("image")
        s[f"game{i}-side2-logo"] = Slot("image")
        s[f"game{i}-side1-score"] = Slot("text")
        s[f"game{i}-side2-score"] = Slot("text")
        s[f"game{i}-side1-name"] = Slot("text")
        s[f"game{i}-side2-name"] = Slot("text")
        # away/home-oriented restatement (awaySide comes from the server)
        for role in ("away", "home"):
            s[f"game{i}-{role}-name"] = Slot("text")
            s[f"game{i}-{role}-score"] = Slot("text")
            s[f"game{i}-{role}-logo"] = Slot("image")
        # WHO WON, drawn rather than inferred: `-win` is the winning side's own
        # marker and `-row` the whole row (logo included) the loser's dim is
        # applied to. Both orientations, all optional -- `rowOutcome` in
        # matchup-mount.js is the rule, including why `-row` and the per-node
        # dim are exclusive.
        for role in ("side1", "side2", "away", "home"):
            s[f"game{i}-{role}-row"] = Slot("any")
            s[f"game{i}-{role}-win"] = Slot("any")
        s[f"game{i}-mode"] = Slot("text")
        s[f"game{i}-stadium"] = Slot("text")
        s[f"game{i}-date"] = Slot("text")
        s[f"game{i}-date-full"] = Slot("text")
    return s


def _statsbar_slots() -> dict[str, Slot]:
    s: dict[str, Slot] = {
        "char-icon": Slot("image"),
        "card-bg": Slot("any", required=True),
        "content": Slot("group", required=True),
        "line-group": Slot("group"),
        "line-label": Slot("text"),
        "line-text": Slot("text"),
        # Optional: the BAND the stat cells divide by each category's character
        # budget (data-span-x / data-span-w; layoutStatCells in mount-utils.js).
        # Absent, the theme's authored columns stand.
        "stat-row": Slot("group"),
    }
    for i in range(6):
        core = i <= 3  # four stats filled today; 4-5 reserved
        s[f"stat-{i}-value"] = Slot("text", required=core)
        s[f"stat-{i}-label"] = Slot("text", required=core)
    return s


def _scoreboard_slots() -> dict[str, Slot]:
    # Authoritative inventory: the ROW-STACK + DATA SLOTS header in
    # public/layout/lib/scoreboard-mount.js. All optional — each size
    # implements whatever subset fits (s omits the box score), and the mount
    # skips absent slots. Count dots / bases are recoloured by the mount via
    # setAttribute, so any shape works ("any").
    s: dict[str, Slot] = {
        "card-bg": Slot("any"),
        "card-rail": Slot("any"),
        "row-top": Slot("group"),
        "row-bottom": Slot("group"),
        "row-inning": Slot("group"),
        "row-live": Slot("group"),
        "row-final": Slot("group"),
        "row-roster": Slot("group"),
        "row-box": Slot("group"),
        # Optional game-mode band. In an absolute theme it may declare
        # data-cardh to grow the card's height when it shows (see the VERTICAL
        # MELD note in scoreboard-mount.js).
        "row-mode": Slot("group"),
        "logo": Slot("image"),
        "logo-default": Slot("any"),
        "inn-half": Slot("text"),
        "inn-num": Slot("text"),
        "inn-arrow-up": Slot("group"),
        "inn-arrow-down": Slot("group"),
        "final-badge": Slot("group"),
        # Text-count themes (Scoreboard S) render the count as numbers rather
        # than lit dots.
        "balls": Slot("text"),
        "strikes": Slot("text"),
        "bat-icon": Slot("image"),
        "pit-icon": Slot("image"),
        "bat-name": Slot("text"),
        "pit-name": Slot("text"),
        # The live cluster PER SIDE: whoever side T has on the field, the role
        # they are in (AB / P), and their four headline stats. The bat-/pit-
        # slots above are the same content pinned to fixed left/right positions
        # — a theme takes one arrangement or the other.
        **{f"s{t}-live-icon": Slot("image") for t in (1, 2)},
        **{f"s{t}-role": Slot("text") for t in (1, 2)},
        **{f"s{t}-stat-{i}-{part}": Slot("text")
           for t in (1, 2) for i in range(4) for part in ("label", "value")},
        "meta-main": Slot("text"),
        "meta-date": Slot("text"),
        # Unlike the two above (completed-game only), this one is bound in both
        # states — every size may place it.
        "meta-game-mode": Slot("text"),
        # The linescore's two layout groups. box-total (the R cluster) nests
        # inside box-grid (the whole table); the mount slides the first left by
        # the unused innings' width and the second back right by half of it, so
        # a five-inning game closes the canyon a nine-column grid leaves. Both
        # optional — without them a theme keeps its authored fixed positions.
        "box-grid": Slot("group"),
        "box-total": Slot("group"),
        "box-away-r": Slot("text"),
        "box-home-r": Slot("text"),
        "box-away-name": Slot("text"),
        "box-home-name": Slot("text"),
    }
    for t in (1, 2):
        s[f"s{t}-logo"] = Slot("image")
        s[f"s{t}-name"] = Slot("text")
        s[f"s{t}-score"] = Slot("text")
        s[f"s{t}-cap-ring"] = Slot("any")
        for i in range(9):
            s[f"s{t}-char-{i}"] = Slot("image")
    # One short of each terminal value: the game never sits at four balls,
    # three strikes or three outs (walk / strikeout / side retired all reset the
    # count before the next frame), so the mount only ever lights 3/2/2 and a
    # theme drawing the extra dot would be drawing one that can never come on.
    for i in range(3):
        s[f"ball-{i}"] = Slot("any")
    for i in range(2):
        s[f"strike-{i}"] = Slot("any")
        s[f"out-{i}"] = Slot("any")
    for b in (1, 2, 3):
        s[f"base-{b}"] = Slot("any")
        s[f"runner-{b}"] = Slot("image")
    for i in range(1, 10):
        s[f"box-col-{i}"] = Slot("group")
        s[f"box-h-{i}"] = Slot("text")
        s[f"box-away-{i}"] = Slot("text")
        s[f"box-home-{i}"] = Slot("text")
    return s


_TICKER_PARTS = {
    # Not inside card-template: the badge's optional atmosphere layer, which
    # the default package runs behind RESULTS and clips with its own clipPath.
    # The badge is the one STATIC region of a moving element -- a sprite inside
    # the card template would be animated once per clone.
    "field": Slot("group"),
    "away-name": Slot("text", required=True),
    "home-name": Slot("text", required=True),
    "away-cap": Slot("image"),
    "home-cap": Slot("image"),
    "score-away": Slot("text", required=True),
    "score-home": Slot("text", required=True),
    "score-group": Slot("group"),
    # A side's whole cluster (icon, name and score), dimmed for the loser, and
    # the winner's own marker. Both optional and both shared with the Matchup
    # summary's history cards -- see `rowOutcome` in mount-utils.js for why the
    # row dim and the per-node dim are mutually exclusive.
    "away-row": Slot("group"),
    "home-row": Slot("group"),
    "away-win": Slot("any"),
    "home-win": Slot("any"),
    "vs": Slot("text"),
    "meta": Slot("text"),
    # The park. Bound but drawn by no shipped theme: the footer carries the
    # MODE, because the competition earns the line and the park is flavour a
    # results card does not need. Dropping a fact from a theme is not dropping
    # it from the contract, so a package that wants it only has to draw it.
    "stadium": Slot("text"),
    "card-bg": Slot("any"),
}


_SCHEDULE_PARTS = {
    # Not inside match-template: the optional atmosphere layer, which the
    # default package runs in the header (the one part of this card whose
    # geometry is fixed) and clips with its own clipPath.
    "field": Slot("group"),
    "row-bg": Slot("rect"),
    "rail": Slot("rect"),
    "label": Slot("text"),
    "status": Slot("text"),
    "side1-name": Slot("text", required=True),
    "side2-name": Slot("text", required=True),
    "plate": Slot("rect"),
    "plate-text": Slot("text"),
}


CONTRACTS: dict[str, Contract] = {
    # --- full slot lint ---
    # A band like commentary/playerplates below: the source is the card's box,
    # and a full-canvas theme is bottom-anchored and cropped by the mount.
    "matchup": Contract((1920, 480), "xMidYMax meet", slots=_matchup_slots(),
                        alt_canvases=((1920, 1080),)),
    "statsbar": Contract((452, 118), "xMidYMid meet", slots=_statsbar_slots()),
    # The running order as a board. Full canvas, because the card's HEIGHT is
    # the row count and the mount centres it there; its width and its X are the
    # theme's. `card-bg` declares data-compact-h (the card with zero rows) and
    # `match-template` data-h (the row pitch) — the two numbers the mount needs to
    # resize the card, and the reason a theme can change the row height without
    # touching code.
    "schedule": Contract(
        (1920, 1080), "xMidYMid meet",
        slots={
            "card": Slot("group", required=True),
            "card-bg": Slot("rect", required=True),
            "title": Slot("text"),
            "rows": Slot("group", required=True),
            "match-template": Slot("group", required=True),
            "overflow": Slot("text"),
        },
        parts=_SCHEDULE_PARTS,
        note="card-bg needs data-compact-h (height with zero rows); match-template needs data-h (the row pitch).",
    ),
    "ticker": Contract(
        (1920, 80), "xMidYMid meet",
        slots={
            "card-template": Slot("group", required=True),
            "track": Slot("group", required=True),
        },
        parts=_TICKER_PARTS,
        note="card-template needs data-w (its cloned width); track needs data-vw (visible width).",
    ),
    # --- backdrop: no data slots by design ---
    "callout": Contract(
        (1920, 1080), "xMidYMid slice", slots={},
        note="callout is a pure backdrop — it recolors via CSS vars, data slots are ignored",
    ),
    # scoreboards share one slot vocabulary; each size uses a subset (all optional).
    # TWO sizes: the compact pill and the full card. The 600x200 Medium was
    # retired 2026-08-29 — it had no content of its own, only L's at a smaller
    # scale, so it converged on L every time either was improved. Retiring a
    # size is a supported move, not a breaking one: the mount, the layouts API
    # and designConstants all resolve an unknown or retired ?size= to `l`, so a
    # producer's ?size=m source keeps rendering (at L's 800x460 canvas, so its
    # OBS placement needs redoing once).
    "scoreboard-s": Contract((388, 156), "xMidYMid meet", slots=_scoreboard_slots(),
                             parts={"div": Slot("any")}),
    "scoreboard-l": Contract((800, 460), "xMidYMid meet", slots=_scoreboard_slots(),
                             parts={"div": Slot("any")}),
    # --- canvas checks only (slot lint not transcribed yet) ---
    # The band elements: 1920 wide (spacing is measured against the stream
    # frame) by the height of the card, so the producer places them vertically
    # in OBS. Their mounts bottom-anchor and crop, so the old full canvas is
    # still valid — see alt_canvases.
    "commentary": Contract((1920, 240), "xMidYMax meet", alt_canvases=((1920, 1080),)),
    "playerplates": Contract((1920, 240), "xMidYMax meet", alt_canvases=((1920, 1080),)),
    "lowerthird": Contract((1920, 320), "xMidYMax meet", alt_canvases=((1920, 1080),)),
    # The card is the source: 480-wide column inside an 8-unit gutter, by the
    # tallest the melded stack gets. The old full 1920x1080 frame is an alt
    # canvas — the mount crops a theme authored that way to its own card box
    # (ensureCardBox/reframeLegacyCanvas), so it lands at full size here.
    "scorecard": Contract((496, 766), "xMidYMid meet", alt_canvases=((1920, 1080),)),
    "statscard": Contract((380, 240), "xMidYMid meet"),
}
