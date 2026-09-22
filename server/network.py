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
    """This machine's LAN IPv4 address(es), best first.

    The UDP-connect trick asks the OS which interface would route outward —
    no packet is sent. Hostname resolution is the fallback (and on a machine
    with no route it is all there is). Loopback is never an answer: it is the
    one address a phone cannot use.
    """
    found: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    out: list[str] = []
    for ip in found:
        if ip.startswith("127.") or ip == "0.0.0.0" or ip in out:
            continue
        out.append(ip)
    return out
