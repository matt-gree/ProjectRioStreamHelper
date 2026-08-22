#!/usr/bin/env python3
"""Generate Figma reimport templates from the shipped theme SVGs.

The inverse of scripts/compile-theme.py: that one turns a designer's export into
a shipped theme, this one turns a shipped theme into the file the designer opens.
See server/figma_template.py for why a shipped SVG cannot simply be opened in
Figma (stylesheet CSS, var(), empty image slots, and data-* markers all vanish).

    # every themable element in the default package, dry run
    python scripts/figma-template.py

    # write them
    python scripts/figma-template.py --write

    # one element, from another package
    python scripts/figma-template.py --package classic --element matchup --write

--verify (on by default when writing) round-trips each generated template back
through the theme compiler and diffs the slot inventory against the shipped
file. A template that does not compile back to the same slots is a broken
round trip, and the designer would only find out after doing the work.

Exit code 1 if any file errored or failed round-trip verification.
"""
import argparse
import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.figma_template import build_template, default_tokens  # noqa: E402
from server.theme_compiler import compile_svg  # noqa: E402

LEVEL_TAG = {"error": "ERROR", "warn": " warn", "info": " info"}
OUT_DIR = Path("design-templates")


def slot_inventory(svg_text: str) -> "collections.Counter[str]":
    """Slot names as a MULTISET, not a set.

    Several elements bind one slot name on more than one node (the lower third
    binds 33 nodes across 20 names). A set comparison calls that round trip
    clean even if the generator dropped every duplicate but one, which is
    exactly the failure a designer would not notice until a band came up blank.
    """
    return collections.Counter(re.findall(r'data-slot="([^"]+)"', svg_text))


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--package", default="default", help="source design package (default: default)")
    ap.add_argument("--element", help="one element only (default: all in the package)")
    ap.add_argument("--out", default=str(OUT_DIR), help=f"output folder (default: {OUT_DIR})")
    ap.add_argument("--write", action="store_true", help="write templates (default: dry run)")
    ap.add_argument("--no-verify", action="store_true", help="skip the compile-back round trip")
    args = ap.parse_args()

    pkg_dir = Path("public/design") / args.package
    if not pkg_dir.is_dir():
        print(f"no such package: {pkg_dir}", file=sys.stderr)
        return 1

    files = sorted(pkg_dir.glob("*.svg"))
    if args.element:
        files = [f for f in files if f.stem == args.element]
        if not files:
            print(f"no {args.element}.svg in {pkg_dir}", file=sys.stderr)
            return 1

    tokens = default_tokens()
    if not tokens:
        print("warning: rio-theme/tokens.css not found - var() will not resolve", file=sys.stderr)

    out_dir = Path(args.out)
    failed = 0
    for src in files:
        shipped = src.read_text()
        text, report = build_template(shipped, src.stem, tokens, filename=f"{src.stem}.template.svg")
        errors = [f for f in report.findings if f.level == "error"]

        print(f"\n{src} -> {out_dir / (src.stem + '.template.svg')}  [{len(report.slots)} slots]")
        for f in report.findings:
            print(f"  {LEVEL_TAG[f.level]}  {f.message}")

        if not errors and not args.no_verify:
            back, creport = compile_svg(text, src.stem, filename=f"{src.stem}.svg")
            want, got = slot_inventory(shipped), slot_inventory(back)
            cerrors = [f for f in creport.findings if f.level == "error"]
            if cerrors:
                for f in cerrors:
                    print(f"  ERROR  round trip: {f.message}")
                failed += 1
            elif want != got:
                for name in sorted(set(want) | set(got)):
                    if want[name] != got[name]:
                        print(f"  ERROR  round trip: slot '{name}' "
                              f"{want[name]} node(s) -> {got[name]}")
                failed += 1
            else:
                print(f"  ok     round trip: {sum(got.values())} slot node(s) "
                      f"across {len(got)} name(s) recovered")

        if errors:
            failed += 1
        elif args.write:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{src.stem}.template.svg").write_text(text)

    if not args.write:
        print("\n(dry run - pass --write to save)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
