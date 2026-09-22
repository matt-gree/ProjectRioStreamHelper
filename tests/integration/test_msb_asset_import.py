"""Importing an MSB image pack COPIES it into PRSH's own folder.

PRSH ships no MSB images and declares the pack required, so this is the first
thing a new user does and the only one of PRSH's setup steps that moves files.

Two properties, and neither is cosmetic:

  - The pack is found wherever it sits inside what the producer picked. A zip
    wraps its contents in a folder and a picker lands wherever the producer
    last was, so demanding the exact directory turns a correct pack into five
    red MISSING chips with nothing saying why.
  - The files are COPIED, and the pointer override is cleared. `Browse…` stores
    a path into somebody's Downloads; that breaks the overlays the day it is
    tidied, mid-broadcast, with missing art as the only symptom.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import server.api.v1.assets as assets
from server.api import router_v1
from server.settings import Settings

PNG = b"\x89PNG\r\n\x1a\n"


@pytest.fixture
def dest(tmp_path, monkeypatch):
    d = tmp_path / "prsh_assets"
    d.mkdir()
    monkeypatch.setattr(assets, "default_msb_assets_dir", lambda: d)
    return d


@pytest.fixture
def client(dest):
    Settings.settings = {"assets": {"msb_path": ""}}
    app = FastAPI()
    app.include_router(router_v1)
    return TestClient(app)


def build_pack(root, categories=("characterIcons", "teamLogos", "gameIcons"), count=3):
    """A pack holding the first `count` canonical filenames per category."""
    root.mkdir(parents=True, exist_ok=True)
    written = 0
    for sub in categories:
        names = assets.REQUIRED_CATEGORIES[sub]()[:count]
        (root / sub).mkdir(parents=True, exist_ok=True)
        for n in names:
            (root / sub / n).write_bytes(PNG)
            written += 1
    return written


def do_import(client, path):
    return client.post(f"/api/v1/assets/msb/import?path={path}")


def test_import_copies_the_pack_into_prsh_own_folder(client, tmp_path, dest):
    src = tmp_path / "Downloads" / "msb-pack"
    expected = build_pack(src)

    r = do_import(client, src)
    assert r.status_code == 200, r.text
    assert r.json()["copied"] == expected

    # The point: the files are OURS now, so deleting the download is harmless.
    icons = assets.REQUIRED_CATEGORIES["characterIcons"]()[:3]
    for n in icons:
        assert (dest / "characterIcons" / n).read_bytes() == PNG


def test_import_finds_the_pack_inside_a_zip_wrapper_folder(client, tmp_path, dest):
    """`msb-assets-v3.zip` unzips to `msb-assets-v3/characterIcons/…`.

    The producer picks the folder the zip made; the categories are one level
    down. Requiring the exact directory would fail every pack shipped as a zip.
    """
    picked = tmp_path / "Downloads"
    expected = build_pack(picked / "msb-assets-v3")

    r = do_import(client, picked)
    assert r.status_code == 200, r.text
    assert r.json()["copied"] == expected


def test_import_clears_a_stale_pointer_override(client, tmp_path):
    """Having just copied a pack in, PRSH's own folder is the one to read.

    Otherwise a producer imports a pack and the census keeps reporting the old
    pointed-at folder — the import appearing to do nothing at all.
    """
    Settings.settings["assets"]["msb_path"] = str(tmp_path / "somewhere-else")
    build_pack(tmp_path / "pack")

    assert do_import(client, tmp_path / "pack").status_code == 200
    assert Settings.Get("assets.msb_path", "") == ""


def test_import_overwrites_so_a_second_import_replaces_the_pack(client, tmp_path, dest):
    """Importing twice is how a pack is REPLACED; skipping existing files
    would leave a producer running a half-updated one."""
    build_pack(tmp_path / "v1")
    do_import(client, tmp_path / "v1")

    src2 = tmp_path / "v2"
    build_pack(src2)
    name = assets.REQUIRED_CATEGORIES["characterIcons"]()[0]
    (src2 / "characterIcons" / name).write_bytes(b"NEWER")

    assert do_import(client, src2).status_code == 200
    assert (dest / "characterIcons" / name).read_bytes() == b"NEWER"


def test_a_folder_with_no_pack_is_refused_by_name(client, tmp_path):
    """The refusal names the folders it looked for — "nothing found" on its own
    leaves a producer re-picking the same wrong folder."""
    empty = tmp_path / "holiday-photos"
    (empty / "june").mkdir(parents=True)

    r = do_import(client, empty)
    assert r.status_code == 400
    assert "characterIcons" in r.json()["detail"]


def test_import_copies_only_canonical_files(client, tmp_path, dest):
    """A download carries readmes and stray art. The category lists are pyrio's
    and are what the census validates against — nothing else is ours to move
    into the producer's app data."""
    src = tmp_path / "pack"
    build_pack(src)
    (src / "characterIcons" / "README.txt").write_text("hello")
    (src / "characterIcons" / "concept-art.psd").write_bytes(b"x" * 100)

    assert do_import(client, src).status_code == 200
    copied = {f.name for f in (dest / "characterIcons").iterdir()}
    assert "README.txt" not in copied
    assert "concept-art.psd" not in copied
