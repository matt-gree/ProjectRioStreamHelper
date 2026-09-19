"""The Network card's readout: the setting, the live bind, and the LAN URL."""

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from server.network import Network, lan_addresses
from server.settings import Settings
from server.utils.router import method

router = APIRouter()


@method(
    router.get, "/network",
    version="1", id="network.get",
    response_class=ORJSONResponse,
)
async def get_network():
    allow_lan = bool(Settings.Get("server.allow_lan", False))
    bound = Network.bound_host
    port = Network.port or Settings.Get("server.port", 5260)
    return {
        "allow_lan": allow_lan,
        # null = unknown (not booted through main.py); the card then trusts
        # the setting rather than inventing a pending restart.
        "lan_bound": None if bound is None else Network.lan_bound(),
        "port": port,
        "addresses": lan_addresses(),
    }
