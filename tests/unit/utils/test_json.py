"""orjson wrapper — async loads/dumps with the inline/thread-hop threshold."""
import orjson

from server.utils import json


async def test_dumps_returns_bytes():
    out = await json.dumps({"a": 1})
    assert isinstance(out, (bytes, bytearray))


async def test_round_trip_small_payload():
    obj = {"score": {"1": {"inning": 3, "outs": 2}}}
    out = await json.dumps(obj)
    assert await json.loads(out) == obj


async def test_round_trip_large_payload_crosses_thread_threshold():
    # > _THREAD_THRESHOLD (4096 bytes) so both the inline and to_thread branches
    # of loads/dumps are exercised across the suite.
    obj = {"items": [{"i": i, "name": f"player_{i}"} for i in range(500)]}
    out = await json.dumps(obj)
    assert len(out) > json._THREAD_THRESHOLD
    assert await json.loads(out) == obj


async def test_dumps_handles_non_str_keys():
    # Default option set includes OPT_NON_STR_KEYS — int keys must serialize,
    # and JSON coerces them to strings on the way back.
    out = await json.dumps({1: "a", 2: "b"})
    assert await json.loads(out) == {"1": "a", "2": "b"}


async def test_dumps_respects_explicit_option():
    out = await json.dumps({"a": 1}, option=orjson.OPT_SORT_KEYS)
    assert await json.loads(out) == {"a": 1}
