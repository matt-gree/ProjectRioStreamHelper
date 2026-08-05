"""Settings pure helpers: defaults merge + secret-key redaction.

Settings.Load migrations (host→allow_lan, overlay schema v2) are Tier 2 and live
in a separate file once the async/tmp_path harness for them lands.

SECRET_KEYS is currently empty (the Challonge API key was its only member), so
the redaction tests patch in a fake secret key to keep the mechanism covered.
"""
import pytest

import server.settings
from server.settings import _deep_merge, redact_value, redact_settings, _REDACTED


@pytest.fixture
def fake_secret(monkeypatch):
    monkeypatch.setattr(server.settings, "SECRET_KEYS", frozenset({"myservice.api_key"}))


# --- _deep_merge ---

def test_deep_merge_loaded_overrides_defaults():
    out = _deep_merge({"a": 1}, {"a": 2})
    assert out["a"] == 2


def test_deep_merge_preserves_default_keys_missing_from_loaded():
    # New default keys must survive an upgrade where the saved file predates them.
    out = _deep_merge({"a": 1, "new": 9}, {"a": 2})
    assert out == {"a": 2, "new": 9}


def test_deep_merge_recurses_into_nested_dicts():
    out = _deep_merge(
        {"server": {"port": 5260, "allow_lan": False}},
        {"server": {"allow_lan": True}},
    )
    assert out["server"] == {"port": 5260, "allow_lan": True}


def test_deep_merge_non_dict_over_dict_replaces():
    out = _deep_merge({"a": {"b": 1}}, {"a": 5})
    assert out["a"] == 5


def test_deep_merge_does_not_mutate_defaults():
    defaults = {"a": {"b": 1}}
    _deep_merge(defaults, {"a": {"c": 2}})
    assert defaults == {"a": {"b": 1}}


# --- _USER_OWNED_MAPS: the exemption, at the helper ---
#
# What the exemption means for the producer-built collections is pinned against
# a real settings file in test_settings_containers.py. These pin the MECHANISM:
# it keys off the dotted path, so it is a property of where a map sits rather
# than of the key's name or its contents.

@pytest.fixture
def exempt_path(monkeypatch):
    monkeypatch.setattr(server.settings, "_USER_OWNED_MAPS",
                        frozenset({"production.container_defs"}))


def test_deep_merge_replaces_a_user_owned_map_wholesale(exempt_path):
    # The seeded entry is absent from loaded — a deletion, not an unset override.
    out = _deep_merge(
        {"production": {"container_defs": {"seeded": {"w": 1}, "other": {"w": 2}}}},
        {"production": {"container_defs": {"other": {"w": 2}}}},
    )
    assert out["production"]["container_defs"] == {"other": {"w": 2}}


def test_deep_merge_seeds_a_user_owned_map_that_is_absent(exempt_path):
    # Absent is the only state meaning "never configured", so the seed lands.
    out = _deep_merge(
        {"production": {"container_defs": {"seeded": {"w": 1}}, "overrides": {}}},
        {"production": {"overrides": {"stats": "Src"}}},
    )
    assert out["production"]["container_defs"] == {"seeded": {"w": 1}}


def test_deep_merge_exemption_is_keyed_on_path_not_name(exempt_path):
    # Same leaf name, different parent: merges like anything else.
    out = _deep_merge(
        {"elsewhere": {"container_defs": {"seeded": {"w": 1}}}},
        {"elsewhere": {"container_defs": {"other": {"w": 2}}}},
    )
    assert out["elsewhere"]["container_defs"] == {"seeded": {"w": 1}, "other": {"w": 2}}


def test_deep_merge_exemption_leaves_sibling_keys_merging(exempt_path):
    out = _deep_merge(
        {"production": {"container_defs": {"seeded": {}}, "spotlight": {"holdMs": 1500,
                                                                        "enabled": False}}},
        {"production": {"container_defs": {}, "spotlight": {"enabled": True}}},
    )
    assert out["production"]["container_defs"] == {}
    assert out["production"]["spotlight"] == {"holdMs": 1500, "enabled": True}


# --- redact_value ---

def test_redact_value_secret_with_value(fake_secret):
    assert redact_value("myservice.api_key", "supersecret") == _REDACTED


def test_redact_value_secret_when_empty_stays_empty(fake_secret):
    assert redact_value("myservice.api_key", "") == ""


def test_redact_value_non_secret_passthrough(fake_secret):
    assert redact_value("server.port", 5260) == 5260


# --- redact_settings ---

def test_redact_settings_masks_secret_key(fake_secret):
    out = redact_settings({"myservice": {"api_key": "abc"}})
    assert out["myservice"]["api_key"] == _REDACTED


def test_redact_settings_empty_secret_becomes_empty_string(fake_secret):
    out = redact_settings({"myservice": {"api_key": ""}})
    assert out["myservice"]["api_key"] == ""


def test_redact_settings_does_not_mutate_input(fake_secret):
    original = {"myservice": {"api_key": "abc"}}
    redact_settings(original)
    assert original["myservice"]["api_key"] == "abc"


def test_redact_settings_absent_secret_is_left_alone(fake_secret):
    out = redact_settings({"server": {"port": 5260}})
    assert out == {"server": {"port": 5260}}
