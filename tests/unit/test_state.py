"""Central state store: emit shapes, change tracking, diff-based Save, export.

socketio.emit is mocked (conftest) and all disk paths are redirected to a temp
dir (conftest isolate_user_data), so these run without a server or touching
user_data.
"""
import pytest

from server.state import State


# --- emit shapes ---

async def test_set_emits_single_frame(mock_socket):
    await State.Set("score.1.inning", 3)
    assert State.state["score"]["1"]["inning"] == 3
    assert "score.1.inning" in State.changed_keys
    mock_socket.assert_awaited_once()
    event, payload = mock_socket.await_args.args
    assert event == "v1.state.set"
    assert payload == {"key": "score.1.inning", "value": 3, "sid": None}


async def test_set_batch_emits_exactly_one_frame(mock_socket):
    # The whole point of SetBatch: N keys → 1 SocketIO frame (perf contract).
    await State.SetBatch([("a", 1), ("b", 2), ("c", 3)])
    assert (State.state["a"], State.state["b"], State.state["c"]) == (1, 2, 3)
    assert mock_socket.await_count == 1
    event, payload = mock_socket.await_args.args
    assert event == "v1.state.set_batch"
    assert payload["items"] == [
        {"key": "a", "value": 1},
        {"key": "b", "value": 2},
        {"key": "c", "value": 3},
    ]


async def test_unset_emits_unset_frame(mock_socket):
    await State.Set("a.b", 1)
    mock_socket.reset_mock()
    await State.Unset("a.b")
    assert "b" not in State.state["a"]
    event, payload = mock_socket.await_args.args
    assert event == "v1.state.unset"
    assert payload == {"key": "a.b", "sid": None}


async def test_session_id_is_echoed_in_payload(mock_socket):
    await State.Set("a", 1, session_id="sess-42")
    _, payload = mock_socket.await_args.args
    assert payload["sid"] == "sess-42"


# --- Save / _compute_changes ---

async def test_save_queues_one_change_and_clears_tracking():
    await State.Set("score.1.inning", 3)
    await State.Save()
    # last_state advanced for the changed path; tracking reset.
    assert State.last_state["score"]["1"]["inning"] == 3
    assert State.changed_keys == []
    assert State.queue.qsize() == 1


async def test_save_no_change_when_value_unchanged():
    await State.Set("a", 1)
    await State.Save()
    assert State.queue.qsize() == 1
    # Set the same value again — Save must detect no diff and enqueue nothing.
    await State.Set("a", 1)
    await State.Save()
    assert State.queue.qsize() == 1


def test_compute_changes_dedupes_repeated_keys():
    State.state = {"a": 2}
    State.last_state = {"a": 1}
    changes = State._compute_changes(["a", "a", "a"])
    assert changes == [{"key": "a", "old": 1, "new": 2, "action": "set"}]


def test_compute_changes_skips_equal_values():
    State.state = {"a": 1}
    State.last_state = {"a": 1}
    assert State._compute_changes(["a"]) == []


# --- Export (stream labels) ---

async def test_export_writes_label_when_enabled(set_setting, isolate_user_data):
    set_setting("general.disable_export", False)
    changes = [{"key": "score.1.batter", "old": None, "new": "Mario", "action": "set"}]
    await State.Export(changes)
    label = isolate_user_data / "stream_labels" / "score" / "1" / "batter.txt"
    assert label.read_text() == "Mario"


async def test_export_skips_labels_when_disabled(set_setting, isolate_user_data):
    set_setting("general.disable_export", True)
    changes = [{"key": "score.1.batter", "old": None, "new": "Mario", "action": "set"}]
    await State.Export(changes)
    label = isolate_user_data / "stream_labels" / "score" / "1" / "batter.txt"
    assert not label.exists()


@pytest.mark.parametrize("flag,should_write", [
    ("false", True),   # string flags from query-param PUTs are coerced
    ("0", True),
    ("off", True),
    ("1", False),
    ("true", False),
])
async def test_export_coerces_string_disable_flag(set_setting, isolate_user_data, flag, should_write):
    set_setting("general.disable_export", flag)
    changes = [{"key": "x", "old": None, "new": "v", "action": "set"}]
    await State.Export(changes)
    assert (isolate_user_data / "stream_labels" / "x.txt").exists() is should_write


async def test_export_always_writes_state_json(set_setting, isolate_user_data):
    # SaveImmediately runs regardless of the export flag.
    set_setting("general.disable_export", True)
    State.state = {"a": 1}
    await State.Export([])
    assert (isolate_user_data / "state.json").exists()
