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
