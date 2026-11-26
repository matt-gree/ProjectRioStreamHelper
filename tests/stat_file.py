"""A real, pyrio-readable stat file for tests, with chosen fields overridden.

pyrio reads a stat file whole, so a test file can't be a handful of keys. This
starts from pyrio's own 2.2.0 decoded fixture (in the pinned submodule) and
replaces top-level fields: ``GameID``, ``Loaded from HUD``, the players, the
final scores, ``Date - End``.
"""
import json
from pathlib import Path

import orjson

FIXTURE = (Path(__file__).resolve().parents[1] / "server" / "rio" / "pyrio" / "tests" / "fixtures"
           / "decoded.20260618T191655_SpiceOrange-Vs-MattGree_3896251267.json")


def stat_file_json(**fields) -> dict:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data.update(fields)
    return data


def write_stat_file(path: Path, **fields) -> Path:
    path.write_bytes(orjson.dumps(stat_file_json(**fields)))
    return path
