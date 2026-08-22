"""The Figma round trip: shipped theme -> template -> compiled theme.

The template generator (server/figma_template.py) and the theme compiler
(server/theme_compiler.py) are inverses, and the whole designer workflow rests
on that. Nothing in either module's own tests can see a break in the seam
BETWEEN them: the generator can happily emit a layer name the compiler parses
into a different slot, and both files stay individually correct while the
designer's export silently loses a binding.

So these tests run the loop on every shipped theme, which is also what makes
them a live audit of the theme files themselves — the `box-away-R` slot that
no grammar id could express was found this way, not by reading either module.
"""
import collections
import re
from pathlib import Path

import pytest

from server.figma_template import (
    SEAM_SENTINELS,
    build_template,
    default_tokens,
    load_tokens,
    resolve_value,
    simplify_font,
)
from server.theme_compiler import compile_svg, parse_grammar_id

PACKAGES = Path("public/design")
SHIPPED = sorted(PACKAGES.glob("*/*.svg"))


def slot_counts(svg: str) -> collections.Counter:
    """Slot names as a MULTISET — several elements bind one name on many nodes
    (the lower third: 33 nodes across 20 names), and a set comparison would call
    it clean with every duplicate but one dropped."""
    return collections.Counter(re.findall(r'data-slot="([^"]+)"', svg))


@pytest.fixture(scope="module")
def tokens():
    return default_tokens()


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_round_trip_preserves_every_slot_node(src, tokens):
    """A designer's edit must not be able to lose a binding in transit."""
    shipped = src.read_text()
    template, treport = build_template(shipped, src.stem, tokens)
    assert not [f for f in treport.findings if f.level == "error"], treport.findings

    back, creport = compile_svg(template, src.stem)
    assert not [f for f in creport.findings if f.level == "error"], creport.findings
    assert slot_counts(back) == slot_counts(shipped)


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_every_shipped_slot_name_is_expressible_as_a_layer_name(src):
    """Figma keeps layer NAMES, not attributes, so a slot the grammar cannot
    spell cannot survive a design tool at all — and fails silently, because the
    compiler lowercases the name rather than rejecting it and the mount just
    finds nothing to fill. `box-away-R`/`box-home-R` were exactly this."""
    for name in set(re.findall(r'data-slot="([^"]+)"', src.read_text())):
        parsed = parse_grammar_id(f"slot={name}")
        assert parsed is not None, f"{name!r} is not a grammar id at all"
        marker, parsed_name, _, problems = parsed
        assert not problems, f"{name!r}: {problems}"
        assert parsed_name == name, (
            f"slot {name!r} round-trips through the layer-name grammar as "
            f"{parsed_name!r} — rename it to lowercase-with-dashes"
        )


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_template_carries_no_stylesheet_or_unresolved_var(src, tokens):
    """The two things Figma silently ignores. A template that still contains
    either is one the designer opens with black text and no fills."""
    template, _ = build_template(src.read_text(), src.stem, tokens)
    # Comments are stripped before the check: several themes *document* the
    # var() rule in an authored note, and that prose is not markup Figma reads.
    markup = re.sub(r"<!--.*?-->", "", template, flags=re.S)
    assert "<style" not in markup, "stylesheet CSS survives — Figma will not apply it"
    assert "var(" not in markup, "unresolved var() survives — Figma resolves no custom properties"


def test_seam_colours_survive_as_sentinels(tokens):
    """side1 and accent both resolve to Rio red live, so a template that baked
    side1 to its true value would compile back as accent — the two would swap on
    every round trip and a producer's accent change would repaint a player."""
    assert SEAM_SENTINELS["side1"] != tokens["--accent"]
    assert resolve_value("var(--side1)", tokens) == SEAM_SENTINELS["side1"]
    assert resolve_value("var(--accent)", tokens) == SEAM_SENTINELS["accent"]
    # a non-seam token resolves to its real value, through one level of alias
    assert resolve_value("var(--band)", tokens).lower() == "#0b0b12"


def test_var_fallback_is_used_when_the_token_is_unknown(tokens):
    assert resolve_value("var(--not-a-token, #ff00ff)", tokens) == "#ff00ff"


def test_font_stack_reduces_to_one_family():
    """Figma binds a text node to ONE font; handed a stack it substitutes."""
    assert simplify_font("'Rajdhani', 'Arial Narrow', sans-serif") == "Rajdhani"
    assert simplify_font("var-free, monospace") == "var-free"


def test_load_tokens_resolves_nested_aliases():
    tokens = load_tokens(":root{--a:#123456;--b:var(--a);--c:var(--b)}")
    assert tokens["--c"] == "#123456"
