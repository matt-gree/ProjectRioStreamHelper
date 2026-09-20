"""App metadata survives into a frozen build.

`pyproject.toml` is a BUILD file and is not bundled, so `Config.Load` reading
it directly meant a packaged app had no source for its own name, description
and authors — it silently fell back to the hardcoded defaults and served
`"authors": []` from GET /api/v1/config on every release, while a dev server
answered the same endpoint correctly. One fact, three copies, and the two that
shipped were the wrong ones.

The fix routes metadata through the same chain as the version
(scripts/freeze-version.py): pyproject in a checkout, the generated
`server/_version.py` in a bundle. These tests cover the frozen leg, because
that is the one nothing else exercises — a source checkout always has
pyproject, so every existing test passes whether or not the freeze works.
"""
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
FREEZE = REPO / "scripts" / "freeze-version.py"


@pytest.fixture
def fv():
    """The freeze-version module, loaded by path (its filename has a hyphen)."""
    spec = importlib.util.spec_from_file_location("_freeze_version_test", FREEZE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_pyproject_metadata_carries_the_fields_config_publishes(fv):
    meta = fv._read_pyproject_metadata(REPO)
    assert meta is not None, "pyproject.toml should be readable from a checkout"
    assert set(meta) == {"name", "description", "authors"}
    assert meta["name"] == "ProjectRioStreamHelper"
    assert meta["authors"], "authors must not be empty — this is the bug"


def test_the_fork_author_is_named_first(fv):
    """Upstream attribution is retained (MIT requires it, see LICENSE), but the
    list is served publicly and previously named only people who did not write
    this fork."""
    authors = fv._read_pyproject_metadata(REPO)["authors"]
    assert "Matt Greene" in authors[0]
    assert any("João Ribeiro Bezerra" in a for a in authors), "upstream credit dropped"


def test_a_frozen_build_round_trips_the_metadata(fv, tmp_path):
    """write → read, the path a packaged build actually takes."""
    frozen = tmp_path / "_version.py"
    original = fv._read_pyproject_metadata(REPO)
    fv.write_frozen("9.9.9", frozen, original)

    assert fv._read_frozen(frozen) == "9.9.9"
    assert fv._read_frozen_metadata(frozen) == original


def test_non_ascii_authors_survive_the_freeze(fv, tmp_path):
    """The upstream author's name carries a diacritic, and the generated file
    is parsed by a line scan rather than imported — so the repr has to round
    trip exactly."""
    frozen = tmp_path / "_version.py"
    meta = {"name": "X", "description": "d", "authors": ["João Ribeiro Bezerra <j@x>"]}
    fv.write_frozen("1.0.0", frozen, meta)
    assert fv._read_frozen_metadata(frozen) == meta


def test_metadata_is_written_on_one_line(fv, tmp_path):
    """`_read_frozen_metadata` is a LINE SCAN on purpose — it must work before
    the server package is importable and must not execute a malformed file. A
    pretty-printed multi-line dict would silently stop being readable."""
    frozen = tmp_path / "_version.py"
    fv.write_frozen("1.0.0", frozen, {"name": "X", "description": "d", "authors": ["a", "b"]})
    lines = [ln for ln in frozen.read_text(encoding="utf-8").splitlines() if ln.startswith("METADATA")]
    assert len(lines) == 1
    assert lines[0].rstrip().endswith("}")


def test_a_malformed_frozen_file_resolves_to_nothing_rather_than_raising(fv, tmp_path):
    """Config.Load must degrade to its defaults, never fail boot."""
    frozen = tmp_path / "_version.py"
    frozen.write_text("VERSION = \"1.0\"\nMETADATA = {this is not python\n", encoding="utf-8")
    assert fv._read_frozen_metadata(frozen) is None


def test_missing_file_resolves_to_nothing(fv, tmp_path):
    assert fv._read_frozen_metadata(tmp_path / "nope.py") is None


@pytest.mark.asyncio
async def test_config_load_publishes_real_authors():
    """The endpoint's actual payload — the thing that was wrong."""
    from server.settings import Config
    cfg = await Config.Load()
    assert cfg["name"] == "ProjectRioStreamHelper"
    assert cfg["authors"], "GET /api/v1/config served an empty authors list"
    assert cfg["version"] != "1.0.0", "the stale hardcoded default is back"


@pytest.mark.asyncio
async def test_metadata_resolves_with_the_freeze_script_unavailable(monkeypatch, tmp_path):
    """THE ACTUAL FROZEN CASE, and the one that shipped broken twice.

    `scripts/` is not in PRSH.spec's datas, so `_load_freeze_version_module`
    returns None in every packaged build. The first fix routed metadata through
    that module and passed every test in this file — while the frozen app went
    on serving `"authors": []`, because a source checkout can always load the
    script and so no test ever took the path a release takes.

    Simulate it by removing the module, exactly as the bundle does.

    The generated `_version.py` is WRITTEN HERE rather than read off disk.
    It is gitignored — `prebuild` produces it — so asserting against whatever
    happens to be in `server/` passes on any machine that has run a build and
    fails in CI, which nothing there generates. That is not a flake: the test
    was silently measuring the developer's build state instead of the
    behaviour, and it went green locally while failing the moment it ran
    anywhere clean.
    """
    import server.settings as settings

    frozen = tmp_path / "_version.py"
    frozen.write_text(
        'VERSION = "9.9.9-test"\n'
        'METADATA = {"name": "ProjectRioStreamHelper", '
        '"description": "test", "authors": ["Matt Greene"]}\n',
        encoding="utf-8",
    )

    monkeypatch.setattr(settings, "_load_freeze_version_module", lambda: None)
    monkeypatch.setattr(settings, "_frozen_version_file", lambda: frozen)
    meta = settings._resolve_metadata()

    assert meta.get("authors"), (
        "with the freeze script absent, metadata must still come from the "
        "generated server/_version.py — this is the frozen build's only source"
    )
    assert meta.get("name") == "ProjectRioStreamHelper"
