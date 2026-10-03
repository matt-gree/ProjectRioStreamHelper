"""The Network card's readout: the setting, the live bind, and the LAN URL."""

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.network import Network, lan_addresses, network_category
from server import source_addresses
from server.lan_access import LanAccess
from server.settings import Settings

router = APIRouter()


# HTTP only: the answer depends on which machine is asking (the request's
# client address), which a socket event cannot supply.
@router.get("/network", response_class=ORJSONResponse)
async def get_network(request: Request, peer: str | None = None):
    allow_lan = bool(Settings.Get("server.allow_lan", False))
    bound = Network.bound_host
    port = Network.port or Settings.Get("server.port", 5260)
    addresses = lan_addresses(peer)
    me = _is_self(request)
    return {
        "allow_lan": allow_lan,
        # null = unknown (not booted through main.py); the card then trusts
        # the setting rather than inventing a pending restart.
        "lan_bound": None if bound is None else Network.lan_bound(),
        "port": port,
        # `?peer=` (the OBS host) answers with the interface that reaches it.
        "addresses": addresses,
        # The last request from ANOTHER machine — the outside-in answer to "is
        # anything getting through?" (a firewall can't be tested from inside).
        "last_remote": Network.last_remote_info(),
        # Windows only, once LAN is wanted: a Public network blocks inbound.
        "network_category": (await asyncio.to_thread(network_category, addresses[0] if addresses else None))
        if allow_lan else None,
        # The PIN itself only ever goes to the PRSH computer.
        **LanAccess.status(for_self=me),
        "this_computer": me,
    }


def _is_self(request: Request) -> bool:
    return Network.is_self_client(request.client.host if request.client else None)


def _lan_bound() -> bool:
    # null bind = not booted through main.py (tests); trust the setting.
    if Network.bound_host is None:
        return bool(Settings.Get("server.allow_lan", False))
    return Network.lan_bound()


class ObsSources(BaseModel):
    obs_host: str | None = None
    urls: list[str] = []


# HTTP only (no socket event): the answer depends on the REQUEST's client
# address — which machine the asking console is on.
@router.post("/network/obs-sources", response_class=ORJSONResponse)
async def obs_sources(body: ObsSources, request: Request):
    """Which of these PRSH source URLs no longer reach PRSH from where OBS is,
    and what each should be (server/source_addresses.py)."""
    port = Network.port or Settings.Get("server.port", 5260)
    client_ip = request.client.host if request.client else None
    key = LanAccess.key if LanAccess.required() else None
    return source_addresses.repair(body.urls, body.obs_host or "", client_ip, int(port), _lan_bound(), key)


class PinChange(BaseModel):
    enabled: bool | None = None
    regenerate: bool = False


@router.post("/network/pin", response_class=ORJSONResponse)
async def set_pin(body: PinChange, request: Request):
    """Turn the LAN PIN on/off or issue a new one — from the PRSH computer only,
    or a device let in by the PIN could switch it off."""
    if not _is_self(request):
        return ORJSONResponse({"error": "Change the PIN from the computer running PRSH."}, status_code=403)
    LanAccess.configure(enabled=body.enabled, regenerate=body.regenerate)
    return LanAccess.status(for_self=True)
