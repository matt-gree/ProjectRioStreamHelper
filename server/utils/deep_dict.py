def deep_get(dictionary: dict, keys: str, default=None):
    d = dictionary
    for key in keys.split("."):
        if isinstance(d, dict):
            d = d.get(key, default)
        else:
            return default
    return d


def deep_set(dictionary: dict, keys: str, value):
    """Set a dotted path, creating intermediate dicts as needed.

    A non-dict sitting on the path (None, a scalar, a list) is REPLACED by a
    dict: the caller asked for a deeper path, so the shallower value cannot
    stand. Testing the value rather than `key not in d` is what keeps this from
    descending into a non-dict and raising.
    """
    d = dictionary
    parts = keys.split(".")
    for key in parts[:-1]:
        nxt = d.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            d[key] = nxt
        d = nxt
    d[parts[-1]] = value


def deep_unset(dictionary: dict, keys: str):
    """Remove a dotted path. A path that does not exist — or that runs through a
    non-dict, so cannot exist — is a no-op rather than an error."""
    d = dictionary
    parts = keys.split(".")
    for key in parts[:-1]:
        d = d.get(key)
        if not isinstance(d, dict):
            return
    d.pop(parts[-1], None)
