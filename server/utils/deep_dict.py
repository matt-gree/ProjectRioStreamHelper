def deep_get(dictionary: dict, keys: str, default=None):
    d = dictionary
    for key in keys.split("."):
        if isinstance(d, dict):
            d = d.get(key, default)
        else:
            return default
    return d


def deep_set(dictionary: dict, keys: str, value):
    d = dictionary
    parts = keys.split(".")
    for key in parts[:-1]:
        if key not in d:
            d[key] = {}
        d = d[key]
    d[parts[-1]] = value


def deep_unset(dictionary: dict, keys: str):
    d = dictionary
    parts = keys.split(".")
    for key in parts[:-1]:
        if key not in d:
            return
        d = d[key]
    d.pop(parts[-1], None)
