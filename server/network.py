"""How this PRSH process is actually served on the network.

`server.allow_lan` is what the producer ASKED for; the bind is fixed at boot
(main.py), so the two disagree until a restart. The Connections tab's Network
card needs both — the setting to show the switch, the bind to say whether the
switch has taken effect yet — plus the address a phone on the same network
should open, which is the one thing a producer turning LAN on actually wants.
"""

import socket


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


def lan_addresses() -> list[str]:
    """The address a phone on this network should open — ONE of them.

    The UDP-connect trick asks the OS which interface would route outward —
    no packet is sent — and that is the answer. Hostname resolution is only
    the fallback (on a machine with no route it is all there is), never a
    second answer beside it: a laptop on Wi-Fi AND Ethernet resolves its
    hostname to both, both on the same subnet, and the card listed two URLs
    for one computer with nothing saying why or which to use. Loopback is
    never an answer: it is the one address a phone cannot use.

    A list, still, so "none found" stays an empty one.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
        if _usable(ip):
            return [ip]
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            if _usable(info[4][0]):
                return [info[4][0]]
    except OSError:
        pass
    return []


def _usable(ip: str) -> bool:
    return not (ip.startswith("127.") or ip == "0.0.0.0")
