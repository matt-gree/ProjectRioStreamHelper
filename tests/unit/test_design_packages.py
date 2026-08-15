"""Package info — in particular which elements a package paints ITSELF.

A theme SVG declares ``data-design-vars="app"`` on its root to be painted by
the user's Design-tab colour/typography knobs; without it it brings a fixed
palette and the mount *clears* those vars (svg-theme-engine.js ``usesAppVars``).
The UI hides the app-palette settings for a full-art element, so this flag is
the difference between a control that works and a control that does nothing —
which is the one failure a screenshot can't show.
"""

import json

import pytest

from server import design_packages


def _pkg(name: str) -> dict:
    return next(p for p in design_packages.list_packages() if p["id"] == name)


def test_default_is_full_art_and_classic_is_a_token_skin():
    default, classic = _pkg("default"), _pkg("classic")
    # Every element `default` themes brings its own palette. That is what makes
    # it the fallback tier: an element no package themes lands here, so "not
    # themed anywhere" and "not repaintable" have to be the same answer.
    assert default["appVarElements"] == []
    assert "commentary" in default["elements"]
    # `classic` is the pre-2.0 look — the knobs paint it.
    assert "stats" in classic["appVarElements"]
    assert "ticker" in classic["appVarElements"]


def test_the_tier_is_per_element_even_inside_one_package():
    """The reason there is no per-package answer to ask for instead.

    `classic` is the token skin, and its own callout is full-art — so a UI that
    asked "is this package customisable" would offer dead colour knobs on the
    callout under `classic`, and hide live ones under a package that was
    full-art everywhere but one element.
    """
    classic = _pkg("classic")
    assert "callout" in classic["elements"]
    assert "callout" not in classic["appVarElements"]


def test_a_hand_dropped_package_is_read_from_its_files_not_its_manifest(tmp_path, monkeypatch):
    """`palette` in package.json is an input to the theme COMPILER, not a fact.

    It only ever reaches the served SVG through an install; a folder dropped
    straight into user_data never runs the compiler, so believing the manifest
    would report a palette the mounts don't honour.
    """
    root = tmp_path / "design_packages"
    folder = root / "liar"
    folder.mkdir(parents=True)
    monkeypatch.setattr(design_packages, "user_packages_dir", lambda: root)
    folder.joinpath("package.json").write_text(json.dumps({"id": "liar", "palette": "app"}))
    folder.joinpath("stats.svg").write_text('<svg viewBox="0 0 10 10"></svg>')
    # Single quotes and odd spacing are what a hand-authored root looks like.
    folder.joinpath("ticker.svg").write_text(
        "<?xml version='1.0'?>\n<svg viewBox='0 0 10 10' data-design-vars = 'app'></svg>"
    )

    info = _pkg("liar")
    assert info["elements"] == ["stats", "ticker"]
    assert info["appVarElements"] == ["ticker"]


# --- the controller-port palette -----------------------------------------
#
# `portColors` is the one thing a package declares in its MANIFEST rather than
# on an SVG root, because no single element owns it: five mounts tint their
# sides from the same four colours. It is read straight from package.json (the
# compiler never touches it), so a hand-dropped folder declares it the same way
# an installed zip does.

def _drop(tmp_path, monkeypatch, manifest: dict, pkg_id: str = "ports") -> dict:
    root = tmp_path / "design_packages"
    folder = root / pkg_id
    folder.mkdir(parents=True)
    monkeypatch.setattr(design_packages, "user_packages_dir", lambda: root)
    folder.joinpath("package.json").write_text(json.dumps({"id": pkg_id, **manifest}))
    folder.joinpath("stats.svg").write_text('<svg viewBox="0 0 10 10"></svg>')
    return _pkg(pkg_id)


def test_default_declares_the_port_palette_and_classic_inherits_it():
    # The built-in convention, stated where a package states things. `classic`
    # says nothing, which is not "no ports" but "the app's own palette" —
    # there is deliberately no fallback to `default` for a manifest.
    assert _pkg("default")["portColors"] == ["#e53935", "#1e88e5", "#fdd835", "#43a047"]
    assert _pkg("classic")["portColors"] == []


def test_a_partial_palette_leaves_the_ports_it_omits_alone(tmp_path, monkeypatch):
    """Index i is always port i+1, so a short list pads rather than shifting.

    A package that only wants to recolour ports 1 and 2 must not silently move
    port 3's colour onto port 4.
    """
    info = _drop(tmp_path, monkeypatch, {"portColors": ["#C5F707", "#57E0E7"]})
    assert info["portColors"] == ["#c5f707", "#57e0e7", None, None]


def test_a_junk_entry_drops_to_the_app_default_without_failing_the_package(tmp_path, monkeypatch):
    """The value has to render in a colour input and in a CSS var, so hex only.

    Dropping the bad entry (rather than the package) is what keeps a typo in
    one port from costing a designer their whole theme.
    """
    info = _drop(tmp_path, monkeypatch, {"portColors": ["red", "#1e88e5", 42, "#fdd8"]})
    assert info["portColors"] == [None, "#1e88e5", None, None]


def test_a_package_saying_nothing_about_ports_declares_nothing(tmp_path, monkeypatch):
    assert _drop(tmp_path, monkeypatch, {})["portColors"] == []
    assert _drop(tmp_path, monkeypatch, {"portColors": []}, "empty")["portColors"] == []
    # All-junk is the same statement as none: nothing usable was declared.
    assert _drop(tmp_path, monkeypatch, {"portColors": ["nope"]}, "junk")["portColors"] == []


def test_a_fifth_port_is_dropped(tmp_path, monkeypatch):
    """Four controllers. A fifth entry is a mistake, and carrying it would put a
    colour in the payload that nothing can ever show."""
    info = _drop(tmp_path, monkeypatch, {"portColors": ["#111111"] * 5})
    assert len(info["portColors"]) == 4


# --- install_zip containment ---------------------------------------------
#
# A design package is a bundle a user gets from a designer and installs, so the
# archive is untrusted input by design. Extraction must not be able to write
# outside the package folder.

def _zip_bytes(entries: dict[str, str]) -> bytes:
    import io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, body in entries.items():
            zf.writestr(name, body)
    return buf.getvalue()


@pytest.mark.parametrize("hostile", [
    "../../evil.svg",
    "a/../../evil.svg",
    "..\\..\\evil.svg",
    # The one that got through: split("/") saw a single part, so no component
    # equalled ".." — inert on POSIX, a real separator on Windows.
    "a\\..\\..\\evil.svg",
    "/etc/cron.d/evil.svg",
])
def test_install_zip_never_writes_outside_the_package_dir(tmp_path, monkeypatch, hostile):
    root = tmp_path / "design_packages"
    root.mkdir(parents=True)
    monkeypatch.setattr(design_packages, "user_packages_dir", lambda: root)

    data = _zip_bytes({
        "package.json": json.dumps({"id": "hostile"}),
        "stats.svg": '<svg viewBox="0 0 10 10"></svg>',
        hostile: '<svg viewBox="0 0 10 10"></svg>',
    })
    design_packages.install_zip(data, fallback_id="hostile")

    # The invariant is containment, not rejection: an absolute entry is fine to
    # keep once it has been made relative (it just lands inside the package),
    # while a traversing one must not produce a file at all. Either way nothing
    # may exist outside the package folder.
    pkg = (root / "hostile").resolve()
    written = [p for p in tmp_path.rglob("*") if p.is_file()]
    escaped = [p for p in written if not p.resolve().is_relative_to(pkg)]
    assert not escaped, f"{hostile!r} escaped to {escaped}"

    # The backslash case only ESCAPES on Windows, so containment alone cannot
    # pin it from a POSIX CI run — there it merely lands as a file literally
    # named `a\..\..\evil.svg`. The portable statement of the same bug is that
    # no separator and no traversal survives sanitization, which is true on
    # every platform and false on the code that shipped this.
    for p in written:
        parts = p.relative_to(pkg).parts
        assert "\\" not in str(p.relative_to(pkg)), f"separator survived: {parts}"
        assert ".." not in parts, f"traversal survived: {parts}"
