#!/usr/bin/env python3
"""Compile designer SVG exports into conforming PRSH theme files.

The same compiler that runs on Design-tab zip install (server/theme_compiler.py),
as a CLI for iteration: translate the layer-naming grammar (`slot=side1-name
maxw=420`, `part=rail`, `tpl=match w=620`) into data-* markers, normalize
export quirks, and lint against the element contract. Grammar reference:
public/design/DESIGNER-GUIDE.md.

    # dry run: report only, writes nothing
    python scripts/compile-theme.py my-package/matchup.svg

    # compile a whole package folder in place, then zip + install it
    python scripts/compile-theme.py --write my-package/

    # element inferred from the filename stem; override when it differs
    python scripts/compile-theme.py --element matchup export-v3.svg

Exit code 1 if any file produced an error-level finding.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.theme_compiler import compile_svg  # noqa: E402

LEVEL_TAG = {"error": "ERROR", "warn": " warn", "info": " info"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="Theme SVG file(s) or one package folder")
    ap.add_argument("--element", help="Contract to lint against (default: filename stem)")
    ap.add_argument("--palette", choices=["app"],
                    help="Opt the theme into the Design-tab CSS vars (token skin)")
    ap.add_argument("--write", action="store_true",
                    help="Write compiled output in place (default: dry-run, report only)")
    ap.add_argument("--json", action="store_true", help="Machine-readable report on stdout")
    args = ap.parse_args()

    files: list[Path] = []
    for p in (Path(p) for p in args.paths):
        if p.is_dir():
            files.extend(sorted(p.glob("*.svg")))
        elif p.is_file():
            files.append(p)
        else:
            print(f"not found: {p}", file=sys.stderr)
            return 1
    if not files:
        print("no SVG files found", file=sys.stderr)
        return 1
    if args.element and len(files) > 1:
        print("--element only makes sense with a single file", file=sys.stderr)
        return 1

    reports, had_error = [], False
    for f in files:
        element = args.element or f.stem
        out, report = compile_svg(f.read_text(encoding="utf-8"), element,
                                  filename=f.name, palette=args.palette)
        if args.write and report.changed:
            f.write_text(out, encoding="utf-8")
        reports.append(report)
        had_error = had_error or any(fi.level == "error" for fi in report.findings)

    if args.json:
        print(json.dumps([r.to_dict() for r in reports], indent=2))
    else:
        for r in reports:
            slots = f" — {r.bound}/{r.total} slots bound" if r.total else ""
            action = "compiled" if (r.changed and args.write) else \
                     "would compile" if r.changed else "no changes needed"
            print(f"{r.file} ({action}){slots}")
            for fi in r.findings:
                print(f"  [{LEVEL_TAG[fi.level]}] {fi.message}")
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
