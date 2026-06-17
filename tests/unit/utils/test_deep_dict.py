"""deep_get / deep_set / deep_unset — the dotted-path accessors that the whole
State and Settings layer is built on."""
import pytest

from server.utils.deep_dict import deep_get, deep_set, deep_unset


# --- deep_get ---

def test_deep_get_nested_value():
    d = {"score": {"1": {"inning": 3}}}
    assert deep_get(d, "score.1.inning") == 3


def test_deep_get_top_level():
    assert deep_get({"a": 1}, "a") == 1


def test_deep_get_missing_returns_default():
    assert deep_get({"a": {}}, "a.b.c", default="x") == "x"


def test_deep_get_missing_default_is_none():
    assert deep_get({}, "a.b") is None


def test_deep_get_traversal_through_nondict_returns_default():
    # "a" is an int; descending into "a.b" must not raise, returns default.
    assert deep_get({"a": 5}, "a.b", default="fallback") == "fallback"


def test_deep_get_falsey_value_is_returned_not_default():
    assert deep_get({"a": {"b": 0}}, "a.b", default=99) == 0
    assert deep_get({"a": {"b": False}}, "a.b", default=99) is False


# --- deep_set ---

def test_deep_set_creates_intermediate_dicts():
    d = {}
    deep_set(d, "a.b.c", 7)
    assert d == {"a": {"b": {"c": 7}}}


def test_deep_set_overwrites_existing():
    d = {"a": {"b": 1}}
    deep_set(d, "a.b", 2)
    assert d["a"]["b"] == 2


def test_deep_set_preserves_siblings():
    d = {"a": {"keep": 1}}
    deep_set(d, "a.new", 2)
    assert d == {"a": {"keep": 1, "new": 2}}


def test_deep_set_top_level():
    d = {}
    deep_set(d, "x", 1)
    assert d == {"x": 1}


# --- deep_unset ---

def test_deep_unset_removes_leaf():
    d = {"a": {"b": 1, "c": 2}}
    deep_unset(d, "a.b")
    assert d == {"a": {"c": 2}}


def test_deep_unset_missing_path_is_noop():
    d = {"a": {}}
    deep_unset(d, "a.b.c")  # must not raise
    assert d == {"a": {}}


def test_deep_unset_missing_leaf_is_noop():
    d = {"a": {"b": 1}}
    deep_unset(d, "a.z")
    assert d == {"a": {"b": 1}}


def test_deep_unset_top_level():
    d = {"x": 1, "y": 2}
    deep_unset(d, "x")
    assert d == {"y": 2}
