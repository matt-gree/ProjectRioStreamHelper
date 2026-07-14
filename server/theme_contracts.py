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
    "matchup": Contract((1920, 1080), "xMidYMax meet", slots=_matchup_slots()),
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
    # --- canvas checks only (slot lint not transcribed yet) ---
    "commentary": Contract((1920, 1080), "xMidYMax meet"),
    "playerplates": Contract((1920, 1080), "xMidYMax meet"),
    "lowerthird": Contract((1920, 1080), "xMidYMax meet"),
    "scorecard": Contract((1920, 1080), "xMidYMid meet"),
    "statscard": Contract((380, 220), "xMidYMid meet"),
    "scoreboard-xs": Contract((400, 50), "xMidYMid meet"),
    "scoreboard-s": Contract((500, 80), "xMidYMid meet"),
    "scoreboard-m": Contract((600, 200), "xMidYMid meet"),
    "scoreboard-l": Contract((800, 460), "xMidYMid meet"),
}
