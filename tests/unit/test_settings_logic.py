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
