#!/usr/bin/env python3
"""Tiny CORS receiver that catches a DOM capture and writes it to disk.

Companion to scripts/dom-to-svg.js. The capture has to run INSIDE the rendered
overlay (it needs getComputedStyle and getClientRects), and the overlay has to
be a top-level page — the agent browser pane does not render iframes, so there
is no parent window to hand the result to. Reading a 100 KB+ SVG back out
through the JS-eval bridge means slicing it into a dozen round trips, so the
page posts it here instead, in one call.

    python scripts/capture-receiver.py --out design-templates/captures &
    # ...drive the browser, page POSTs to http://127.0.0.1:8898/<name>.svg
"""
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

OUT = Path("design-templates/captures")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        name = Path(self.path.lstrip("/")).name or "capture.svg"
        if not name.endswith(".svg"):
            name += ".svg"
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / name).write_bytes(data)
        print(f"wrote {OUT / name}  ({len(data):,} bytes)", flush=True)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--port", type=int, default=8898)
    args = ap.parse_args()
    OUT = Path(args.out)
    print(f"receiver on :{args.port} -> {OUT}", flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
