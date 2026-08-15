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
        s[f"game{i}-mode"] = Slot("text")
        s[f"game{i}-stadium"] = Slot("text")
        s[f"game{i}-date"] = Slot("text")
        s[f"game{i}-date-full"] = Slot("text")
    return s


def _stats_slots() -> dict[str, Slot]:
    s: dict[str, Slot] = {
        "char-icon": Slot("image"),
        "card-bg": Slot("any", required=True),
        "content": Slot("group", required=True),
        "line-group": Slot("group"),
        "line-label": Slot("text"),
        "line-text": Slot("text"),
    }
    for i in range(6):
        core = i <= 3  # four stats filled today; 4-5 reserved
        s[f"stat-{i}-value"] = Slot("text", required=core)
        s[f"stat-{i}-label"] = Slot("text", required=core)
    return s


def _scoreboard_slots() -> dict[str, Slot]:
    # Authoritative inventory: the ROW-STACK + DATA SLOTS header in
    # public/layout/lib/scoreboard-mount.js. All optional — each size
    # implements whatever subset fits (xs/s are row-top only), and the mount
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
        "meta-main": Slot("text"),
        "meta-date": Slot("text"),
        # Unlike the two above (completed-game only), this one is bound in both
        # states — every size may place it.
        "meta-game-mode": Slot("text"),
        "elo1-group": Slot("group"),
        "elo2-group": Slot("group"),
        "box-away-R": Slot("text"),
        "box-home-R": Slot("text"),
        "box-away-name": Slot("text"),
        "box-home-name": Slot("text"),
    }
    for t in (1, 2):
        s[f"s{t}-logo"] = Slot("image")
        s[f"s{t}-name"] = Slot("text")
        s[f"s{t}-score"] = Slot("text")
        s[f"s{t}-cap-ring"] = Slot("any")
        s[f"elo{t}-in"] = Slot("text")
        s[f"elo{t}-out"] = Slot("text")
        s[f"elo{t}-delta"] = Slot("text")
        for i in range(9):
            s[f"s{t}-char-{i}"] = Slot("image")
    for i in range(4):
        s[f"ball-{i}"] = Slot("any")
    for i in range(3):
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
    "away-name": Slot("text", required=True),
    "home-name": Slot("text", required=True),
    "away-cap": Slot("image"),
    "home-cap": Slot("image"),
    "score-away": Slot("text", required=True),
    "score-home": Slot("text", required=True),
    "score-group": Slot("group"),
    "vs": Slot("text"),
    "meta": Slot("text"),
    "card-bg": Slot("any"),
}


CONTRACTS: dict[str, Contract] = {
    # --- full slot lint ---
    # A band like commentary/playerplates below: the source is the card's box,
    # and a full-canvas theme is bottom-anchored and cropped by the mount.
    "matchup": Contract((1920, 480), "xMidYMax meet", slots=_matchup_slots(),
                        alt_canvases=((1920, 1080),)),
    "stats": Contract((452, 118), "xMidYMid meet", slots=_stats_slots()),
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
    # scoreboards share one slot vocabulary; each size uses a subset (all optional)
    "scoreboard-xs": Contract((400, 50), "xMidYMid meet", slots=_scoreboard_slots(),
                              parts={"div": Slot("any")}),
    "scoreboard-s": Contract((388, 156), "xMidYMid meet", slots=_scoreboard_slots(),
                             parts={"div": Slot("any")}),
    "scoreboard-m": Contract((600, 200), "xMidYMid meet", slots=_scoreboard_slots(),
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
    "scorecard": Contract((1920, 1080), "xMidYMid meet"),
    "statscard": Contract((380, 240), "xMidYMid meet"),
}
