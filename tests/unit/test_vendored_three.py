"""The vendored three.js matches the version its README claims.

three.js is vendored on purpose — OBS browser sources have to render with no
network, so `public/layout/lib/three/` is pinned to a version, documented with
its jsDelivr source, and updated by hand. That is a sound decision for an app
that ships offline.

What it lacks is any check that the hand step was done completely. "Re-download
the three files and update this note" is four manual actions, and the failure
mode is a README describing a version the bundle is not, discovered by whoever
next tries to reproduce a rendering bug against the documented source. The
`REVISION` constant three.js carries is the file stating its own version, so the
two can be compared for free.

Deliberately does NOT pin a specific version — that is the maintainer's call.
It pins AGREEMENT between the artifact and its documentation.
"""
import re
from pathlib import Path

import pytest

THREE_DIR = Path(__file__).resolve().parents[2] / "public" / "layout" / "lib" / "three"
MODULE = THREE_DIR / "three.module.js"
README = THREE_DIR / "README.md"


def _documented_version() -> str:
    m = re.search(r"\*\*Version:\*\*\s*three\.js\s*`([0-9.]+)`", README.read_text(encoding="utf-8"))
    assert m, "README no longer states a version in the documented format"
    return m.group(1)


def _bundled_revision() -> str:
    # three.js sets `const REVISION = '169';` near the top of the build.
    head = MODULE.read_text(encoding="utf-8", errors="ignore")[:20000]
    m = re.search(r"REVISION\s*=\s*['\"]([^'\"]+)['\"]", head)
    assert m, "could not find three.js REVISION in the vendored bundle"
    return m.group(1)


def test_the_vendored_bundle_matches_the_version_the_readme_documents():
    documented = _documented_version()          # e.g. "0.169.0"
    bundled = _bundled_revision()               # e.g. "169"
    minor = documented.split(".")[1]
    assert bundled == minor, (
        f"README documents three.js {documented} (r{minor}) but the vendored "
        f"bundle reports r{bundled}. Update whichever is stale — see "
        f"{README.relative_to(README.parents[4])}."
    )


@pytest.mark.parametrize("name", [
    "three.module.js",
    "addons/controls/OrbitControls.js",
    "addons/renderers/CSS2DRenderer.js",
])
def test_every_file_the_readme_lists_is_actually_present(name):
    """The addons are imported through the `three/addons/` importmap prefix, so
    a missing one fails at runtime in OBS and nowhere else."""
    assert (THREE_DIR / name).is_file(), f"{name} is documented but missing"
