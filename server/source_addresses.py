"""Which address an OBS browser source must use to reach PRSH — and which of
the sources already in OBS have stopped reaching it.

A source URL bakes in an address, and three ordinary events make that address
wrong with nothing on the console saying so (it recognises a source by its
PATH, so a dead one still lists as healthy):

  - it was made on the PRSH machine, so it says 127.0.0.1, and OBS runs on
    another machine (where 127.0.0.1 is that machine);
  - it says the LAN IP, and the router handed PRSH a new one, or LAN access
    was turned off (PRSH then answers on loopback only);
  - PRSH moved off a busy port.

This is the one statement of the rule, server-side because only the server can
answer its two hard questions: which machine a console's browser is on (it sees
the request's client address), and whether an IP is THIS machine (an old DHCP
address in a stale source is not, any more). Read by `POST /network/obs-sources`
for both the add path and the on-connect repair (`src/lib/obs-reach.js`).
"""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from server.network import is_loopback as _is_loopback
from server.network import is_self, lan_addresses


def where_is_obs(obs_host: str, client_ip: str | None) -> tuple[str, str | None]:
    """('local' | 'remote', the peer to route to when remote).

    `obs.host` is read by the BROWSER, which connects to OBS itself: loopback
    there means "the machine this console is on", so where OBS is follows from
    where the console is.
    """
    obs_host = (obs_host or "127.0.0.1").strip()
    if _is_loopback(obs_host):
        on_self = True if client_ip is None else is_self(client_ip)
        return ("local", None) if on_self else ("remote", client_ip)
    on_self = is_self(obs_host)
    if on_self is None:
        return "remote", obs_host  # a hostname that isn't ours: another machine
    return ("local", None) if on_self else ("remote", obs_host)


def obs_base(where: str, peer: str | None, port: int, lan_bound: bool) -> str | None:
    """The origin a source should use, or None when OBS cannot reach PRSH at all."""
    if where == "local":
        # Loopback, never the LAN IP, on the PRSH machine: it never changes.
        return f"http://127.0.0.1:{port}"
    if not lan_bound:
        return None
    addrs = lan_addresses(peer)
    return f"http://{addrs[0]}:{port}" if addrs else None


def _reaches(host: str, url_port: int | None, where: str, port: int, lan_bound: bool) -> bool | None:
    """Does a URL on host:url_port reach PRSH from where OBS is? None = can't tell."""
    if url_port != port:
        return False
    if _is_loopback(host):
        return where == "local"
    mine = is_self(host)
    if mine is None:
        return None
    return bool(mine and lan_bound)


def _with_key(query: str, key: str | None) -> str:
    pairs = [(k, v) for k, v in parse_qsl(query, keep_blank_values=True) if k != "key"]
    if key:
        pairs.append(("key", key))
    return urlencode(pairs)


def repair(urls: list[str], obs_host: str, client_ip: str | None, port: int, lan_bound: bool,
           key: str | None = None) -> dict:
    """For each PRSH source URL: the URL it should be, when it isn't that now.

    Only BROKEN sources are rewritten: a URL that already reaches PRSH keeps its
    address even when it is not the one we would pick, because rewriting a
    browser source reloads it, and this runs on every connect — mid-show
    included. A source we cannot judge (someone else's hostname) is left alone.

    `key` is the LAN PIN's URL key (server/lan_access.py), passed only while
    the PIN is on. An OBS on another computer needs it on every source, so a
    source without it — or with one from before the PIN was regenerated — is
    broken too. An OBS on this computer is exempt and keeps whatever it has.
    """
    where, peer = where_is_obs(obs_host, client_ip)
    base = obs_base(where, peer, port, lan_bound)
    fixed, unreachable = {}, []
    for url in urls:
        try:
            u = urlsplit(url)
            host, url_port = u.hostname or "", u.port or (443 if u.scheme == "https" else 80)
        except ValueError:
            continue
        path = u.path or "/"
        # The console sends only URLs it recognises as PRSH's (`isPrshUrl`), so
        # one off both PRSH paths is a pre-proxy direct gc-overlay source.
        legacy_gc = not path.startswith(("/layout/", "/gc"))
        if legacy_gc:
            path = "/gc" + (path if path.startswith("/") else "/" + path)
        reaches = _reaches(host, url_port, where, port, lan_bound)
        wants_key = where == "remote" and key and dict(parse_qsl(u.query)).get("key") != key
        if not legacy_gc and reaches is not False and not wants_key:
            continue
        if base is None:
            unreachable.append(url)
            continue
        # A source that reaches PRSH (or that we can't judge) and only lacks
        # the key keeps its address.
        keep = reaches is not False and not legacy_gc
        netloc = u.netloc if keep else urlsplit(base).netloc
        query = _with_key(u.query, key) if wants_key else u.query
        new = urlunsplit((urlsplit(base).scheme, netloc, path, query, u.fragment))
        if new != url:
            fixed[url] = new
    return {"where": where, "base": base, "lan_bound": lan_bound, "fixed": fixed, "unreachable": unreachable}
