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


async def test_http_image_dest_includes_key_path():
    # The http(s) branch of _create_files_dict must build the same
    # path-prefixed destination filename as the './' branch and
    # _remove_files_dict, or create/remove disagree and downloads for
    # different keys collide into the same file.
    path = "score/1/player/1/logo"
    await State._create_files_dict(path, "http://example.com/logo.png")
    assert State.queue.qsize() == 1
    job = await State.queue.get()
    dlpath = str(job.keywords["dlpath"])
    assert dlpath.endswith(f"stream_labels/{path}.png")


# --- write-path hooks ---
#
# A hook is `async (entries) -> [(key, value), ...]`: it sees a write that has
# already landed in `state` and may add entries to the SAME batch. That
# co-location is the whole point — a consumer that decides something off a write
# (the container automation engine) reaches the overlays in the triggering
# frame instead of a round-trip later.


async def test_a_hook_folds_its_entries_into_the_same_batch(mock_socket):
    async def hook(entries):
        return [("derived", len(entries))]

    State.hooks.append(hook)
    await State.SetBatch([("a", 1), ("b", 2)])

    assert State.state["derived"] == 2
    assert "derived" in State.changed_keys      # persisted by the caller's Save
    assert mock_socket.await_count == 1
    _, payload = mock_socket.await_args.args
    assert payload["items"][-1] == {"key": "derived", "value": 2}


async def test_a_hook_reads_the_post_write_world():
    """The write is applied BEFORE the hook, so a rule can resolve content out
    of the same batch that changed it."""
    seen = {}

    async def hook(entries):
        seen["value"] = State.state["score"]["1"]["batter"]
        return []

    State.hooks.append(hook)
    await State.SetBatch([("score.1.batter", "Mario")])
    assert seen["value"] == "Mario"


async def test_a_single_set_with_an_addition_becomes_a_batch_frame(mock_socket):
    """Splitting it would put the trigger on air a frame before its
    consequence. Every consumer handles both shapes."""
    async def hook(entries):
        return [("extra", True)]

    State.hooks.append(hook)
    await State.Set("a", 1)

    assert mock_socket.await_count == 1
    event, payload = mock_socket.await_args.args
    assert event == "v1.state.set_batch"
    assert payload["items"] == [{"key": "a", "value": 1}, {"key": "extra", "value": True}]


async def test_a_set_with_no_hook_addition_keeps_its_single_frame(mock_socket):
    async def hook(entries):
        return []

    State.hooks.append(hook)
    await State.Set("a", 1)
    assert mock_socket.await_args.args[0] == "v1.state.set"


async def test_a_raising_hook_never_loses_the_write(mock_socket):
    async def boom(entries):
        raise RuntimeError("nope")

    async def after(entries):
        return [("still", "ran")]

    State.hooks.extend([boom, after])
    await State.SetBatch([("a", 1)])

    assert State.state["a"] == 1
    assert State.state["still"] == "ran"        # one bad hook doesn't stop the rest
    assert mock_socket.await_count == 1


async def test_unset_observers_see_the_cleared_keys(mock_socket):
    """Unsets can't carry a fold-in — a clear and a set are different frames —
    so observers only observe, and schedule their own follow-up."""
    seen = []

    async def observer(keys):
        seen.append(list(keys))

    State.unset_hooks.append(observer)
    await State.Set("a", 1)
    await State.Unset("a")
    await State.UnsetBatch(["b", "c"])

    assert seen == [["a"], ["b", "c"]]
