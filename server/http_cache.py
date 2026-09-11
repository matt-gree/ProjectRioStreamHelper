"""Cache policy for the files a PRODUCER changes under a running OBS.

WITHOUT A `Cache-Control` HEADER, A BROWSER INVENTS ONE. That is not a quirk of
OBS — it is RFC 9111 §4.2.2, and Chromium (so CEF, so every OBS Browser Source)
implements it as 10% of the time since `Last-Modified`. Starlette's FileResponse
and StaticFiles send `etag` and `last-modified` and NO `cache-control`, so a
theme SVG last edited a week ago is served from cache for about sixteen hours
with no request reaching PRSH at all.

That is why editing a design package looked like it had no effect in OBS while
the app and a pasted link both showed the new file: a top-level NAVIGATION sends
`Cache-Control: max-age=0` and revalidates, but the `fetch()` that
svg-theme-engine.js makes for `/design/{package}/{element}.svg` is an ordinary
subresource request and is answered from the cache without asking. Quitting OBS
doesn't help — the CEF cache is on disk — and neither does re-adding the source,
because the stale entry is keyed by the SVG's URL, not the page's.

`no-cache` is not `no-store`: the file is still cached, but every use must be
revalidated first. Over loopback that is a conditional GET answered with a 304
and no body, which is what makes this free enough to apply to every tree a
producer can edit.

NOT `/assets` — Vite's build output is content-hashed, so a new build is a new
URL and caching it hard is correct. This list is the files whose CONTENT changes
under a URL that doesn't.
"""
from starlette.staticfiles import StaticFiles

# Cache it, but ask first. Every time.
REVALIDATE = "no-cache"

# Served from the repo/bundle: overlay shells + lib/*.js (edited with no build
# step), theme SVGs, the hit visualizer's shared renderer (moves on a submodule
# bump). Served from user_data: branding logos and the MSB asset pack, both of
# which a producer replaces in place, under the same filename, mid-event.
REVALIDATE_PREFIXES = (
    "/layout/",
    "/design/",
    "/rio-visualizer/",
    "/branding/",
    "/game_assets/",
)


def must_revalidate(path: str) -> bool:
    """Is this one of the trees a producer edits while OBS holds it open?"""
    return path.startswith(REVALIDATE_PREFIXES)


class RevalidatingStaticFiles(StaticFiles):
    """StaticFiles that refuses to be heuristically cached.

    The header goes on after the parent has built the response, so it lands on
    a 304 as well as a 200 — `NotModifiedResponse` forwards `cache-control`, but
    only if it is already there when the 304 is built, and it isn't.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["cache-control"] = REVALIDATE
        return response
