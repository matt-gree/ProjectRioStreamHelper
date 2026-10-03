"""Which address an OBS source must carry, and which sources have stopped
reaching PRSH (server/source_addresses.py).

The machines in these cases: PRSH on 192.168.1.20 (the gaming PC), OBS on
192.168.1.40 (the laptop). `is_self` is decided by routing in production; here
it is a table, so each case states which IPs are this machine.
"""
import pytest

from server import network as net
from server import source_addresses as sa

PORT = 5260
L = "/layout/scoreboard1/scoreboard.html?scoreboard=1"


@pytest.fixture(autouse=True)
def machines(monkeypatch):
    mine = {"192.168.1.20"}
    monkeypatch.setattr(net, "_route_source", lambda ip: ip if ip in mine else "192.168.1.20")
    monkeypatch.setattr(sa, "lan_addresses", lambda peer=None: ["192.168.1.20"])
    monkeypatch.setattr(net, "MACHINE_NAMES", {"gaming-pc"})


def run(urls, obs_host, client="127.0.0.1", lan=True, port=PORT):
    return sa.repair(urls, obs_host, client, port, lan)


# ── where OBS is ────────────────────────────────────────────────────────────

def test_loopback_obs_from_the_prsh_machine_is_local():
    assert sa.where_is_obs("127.0.0.1", "127.0.0.1") == ("local", None)


def test_loopback_obs_from_another_machines_console_is_that_machine():
    # The laptop's browser connects to its OWN OBS at 127.0.0.1.
    assert sa.where_is_obs("127.0.0.1", "192.168.1.40") == ("remote", "192.168.1.40")


def test_obs_host_set_to_this_machines_own_ip_is_local():
    assert sa.where_is_obs("192.168.1.20", "192.168.1.40") == ("local", None)


def test_obs_host_on_another_ip_is_remote():
    assert sa.where_is_obs("192.168.1.40", "127.0.0.1") == ("remote", "192.168.1.40")


# ── what gets rewritten ─────────────────────────────────────────────────────

def test_a_loopback_source_on_a_remote_obs_moves_to_the_lan_address():
    r = run([f"http://127.0.0.1:{PORT}{L}"], "192.168.1.40")
    assert r["fixed"] == {f"http://127.0.0.1:{PORT}{L}": f"http://192.168.1.20:{PORT}{L}"}


def test_a_source_on_an_old_dhcp_address_moves_to_the_current_one():
    r = run([f"http://192.168.1.77:{PORT}{L}"], "192.168.1.40")
    assert r["fixed"][f"http://192.168.1.77:{PORT}{L}"] == f"http://192.168.1.20:{PORT}{L}"


def test_a_port_change_is_repaired():
    r = run([f"http://127.0.0.1:5260{L}"], "127.0.0.1", port=5261)
    assert r["fixed"] == {f"http://127.0.0.1:5260{L}": f"http://127.0.0.1:5261{L}"}


def test_lan_off_brings_a_local_obs_back_to_loopback():
    # LAN was on, a source took the LAN IP, then LAN went off: PRSH no longer
    # answers on 192.168.1.20 at all.
    r = run([f"http://192.168.1.20:{PORT}{L}"], "127.0.0.1", lan=False)
    assert r["fixed"] == {f"http://192.168.1.20:{PORT}{L}": f"http://127.0.0.1:{PORT}{L}"}


def test_a_remote_obs_with_lan_off_is_reported_not_rewritten():
    url = f"http://127.0.0.1:{PORT}{L}"
    r = run([url], "192.168.1.40", lan=False)
    assert r["fixed"] == {} and r["unreachable"] == [url] and r["base"] is None


def test_a_working_source_is_never_touched():
    # Rewriting reloads the source, and this runs on every connect.
    urls = [f"http://localhost:{PORT}{L}", f"http://192.168.1.20:{PORT}{L}"]
    assert run(urls, "127.0.0.1")["fixed"] == {}
    assert run([f"http://192.168.1.20:{PORT}{L}"], "192.168.1.40")["fixed"] == {}


def test_this_machines_name_counts_as_this_machine():
    assert run([f"http://gaming-pc.local:{PORT}{L}"], "192.168.1.40")["fixed"] == {}


def test_someone_elses_hostname_is_left_alone():
    assert run([f"http://prsh.example.lan:{PORT}{L}"], "192.168.1.40")["fixed"] == {}


def test_a_direct_gc_overlay_source_moves_onto_the_proxy():
    url = "http://localhost:8069/?port=2&bg=transparent"
    r = run([url], "127.0.0.1")
    assert r["fixed"] == {url: f"http://127.0.0.1:{PORT}/gc/?port=2&bg=transparent"}


def test_a_hostname_we_cannot_judge_keeps_its_address_when_it_gains_the_key():
    url = f"http://prsh.example.lan:{PORT}{L}"
    r = sa.repair([url], "192.168.1.40", "127.0.0.1", PORT, True, key="K")
    assert r["fixed"] == {url: f"{url}&key=K"}
