"""How this PRSH process is actually served on the network.

`server.allow_lan` is what the producer ASKED for; the bind is fixed at boot
(main.py), so the two disagree until a restart. The Connections tab's Network
card needs both — the setting to show the switch, the bind to say whether the
switch has taken effect yet — plus the address a phone on the same network
should open, which is the one thing a producer turning LAN on actually wants.
"""

import ipaddress
import os
import socket
import subprocess
import time


class Network:
    # Set once by main.py after the bind; None in-process (tests, TestClient).
    bound_host: str | None = None
    port: int | None = None

    @classmethod
    def set_bound(cls, host: str, port: int) -> None:
        cls.bound_host = host
        cls.port = int(port)

    @classmethod
    def lan_bound(cls) -> bool:
        return cls.bound_host == "0.0.0.0"

    # ── who has reached us from elsewhere ───────────────────────────────────
    #
    # PRSH cannot test its own LAN address from the inside — that traffic never
    # crosses the firewall — so the honest check is from the other side: the
    # last request that came from another machine. "No other device has
    # connected yet" on a card a producer is staring at because their laptop
    # can't reach PRSH says firewall / wrong address without any guessing.
    last_remote: tuple[str, float] | None = None
    _self_cache: dict[str, bool] = {}

    @classmethod
    def is_self_client(cls, ip: str | None) -> bool:
        """Is a request's client address THIS machine? Cached per IP (the guard
        asks on every request). A non-IP client is an in-process test client."""
        if not ip:
            return True
        mine = cls._self_cache.get(ip)
        if mine is None:
            mine = is_self(ip) is not False
            if len(cls._self_cache) > 256:
                cls._self_cache.clear()
            cls._self_cache[ip] = mine
        return mine

    @classmethod
    def note_client(cls, ip: str | None) -> None:
        """Called per request (origin_guard)."""
        if ip and not cls.is_self_client(ip):
            cls.last_remote = (ip, time.time())

    @classmethod
    def last_remote_info(cls) -> dict | None:
        if cls.last_remote is None:
            return None
        ip, at = cls.last_remote
        return {"ip": ip, "seconds_ago": int(time.time() - at)}


# ── is this machine? ─────────────────────────────────────────────────────────

def is_loopback(host: str) -> bool:
    host = (host or "").lower().strip("[]")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _names() -> set[str]:
    out = set()
    for n in (socket.gethostname(), socket.getfqdn()):
        if n:
            out.update({n.lower(), n.lower().split(".")[0]})
    return out


MACHINE_NAMES = _names()


def is_self(host: str) -> bool | None:
    """True if `host` names this machine, False if another, None for a
    hostname that isn't ours (unjudgeable — callers leave it alone).

    For an IP: routing to one of our own addresses sends FROM that address,
    to anyone else's (an old DHCP lease included) from a different one.
    """
    host = (host or "").lower().strip("[]")
    if is_loopback(host):
        return True
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return True if (host in MACHINE_NAMES or host.split(".")[0] in MACHINE_NAMES) else None
    return _route_source(host) == host


# ── Windows: a Public network blocks inbound connections ──────────────────────
#
# Windows' default firewall profile for a network marked Public refuses inbound
# connections even to an app that was allowed on a Private one, and venue Wi-Fi
# is usually Public. One PowerShell call answers it. Cached, because the card
# polls and powershell.exe takes the better part of a second to start.

_category_cache: dict[str, tuple[float, str | None]] = {}
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def network_category(ip: str | None) -> str | None:
    """'Public' / 'Private' / 'DomainAuthenticated' for the network `ip` is on,
    on Windows; None elsewhere or if it can't tell.

    The interface carrying PRSH's LAN address only: every machine with
    Hyper-V, WSL or VirtualBox has virtual adapters that are routinely
    'Public', and asking about all of them would warn on machines whose real
    network is fine.
    """
    if os.name != "nt" or not ip:
        return None
    try:
        ipaddress.ip_address(ip)  # it goes into a command line
    except ValueError:
        return None
    at, value = _category_cache.get(ip, (0.0, None))
    if time.time() - at < 60:
        return value
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             f"(Get-NetConnectionProfile -InterfaceIndex (Get-NetIPAddress -IPAddress '{ip}').InterfaceIndex).NetworkCategory"],
            capture_output=True, text=True, timeout=8, creationflags=_NO_WINDOW,
        ).stdout.strip()
        value = out.splitlines()[0].strip() if out else None
    except (OSError, subprocess.SubprocessError):
        value = None
    _category_cache[ip] = (time.time(), value)
    return value


# Home/venue networks. A VPN's address (Tailscale's 100.64/10, a work VPN's
# public-looking range) is reachable only by machines on that VPN, so the URL a
# phone or a second PC should open is the one on one of these.
_PRIVATE = tuple(ipaddress.ip_network(n) for n in ("192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"))

# Where to aim the routing probe. One per private range, because a VPN that
# claims 10/8 (common for work VPNs) answers the 10.x probe with ITS address
# while the 192.168 probe still finds the Wi-Fi.
_PROBES = ("192.168.255.255", "10.255.255.255", "172.31.255.255")


def _route_source(dest: str) -> str | None:
    """The address this machine would send from to reach `dest`. No packet is sent."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((dest, 1))
            ip = s.getsockname()[0]
        return ip if _usable(ip) else None
    except OSError:
        return None


def _is_private(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _PRIVATE)


def lan_addresses(peer: str | None = None) -> list[str]:
    """The address another machine should use to reach PRSH — ONE of them.

    With a `peer` (the OBS machine's IP), the answer is the interface the OS
    would route to THAT machine through, which is by definition the one it can
    reach us on — exact, whatever VPNs are up.

    Without one, the routing probe asks the OS which interface would carry
    traffic to each private range (no packet is sent), and a private answer
    wins over anything else: a VPN that captures the route must not put its
    address on the Network card, where the phone on the venue Wi-Fi reads it.
    Hostname resolution is only the fallback (on a machine with no route it is
    all there is), never a second answer beside it: a laptop on Wi-Fi AND
    Ethernet resolves its hostname to both, and the card listed two URLs for
    one computer with nothing saying which to use. Loopback is never an
    answer: it is the one address another machine cannot use.

    A list, still, so "none found" stays an empty one.
    """
    if peer:
        try:
            ipaddress.ip_address(peer)
            ip = _route_source(peer)
            if ip:
                return [ip]
        except ValueError:
            pass  # a hostname: fall through to the general answer
    routed = [ip for ip in (_route_source(d) for d in _PROBES) if ip]
    resolved = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            if _usable(info[4][0]):
                resolved.append(info[4][0])
    except OSError:
        pass
    for pool in (routed, resolved):
        for ip in pool:
            if _is_private(ip):
                return [ip]
    for ip in routed + resolved:
        return [ip]
    return []


def _usable(ip: str) -> bool:
    return not (ip.startswith("127.") or ip == "0.0.0.0" or ip.startswith("169.254."))
