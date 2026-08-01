"""Undo stack for web-side operations.

actions.py records an inverse entry for every mutation; /api/undo pops and
replays it. In-memory only (per Blender session), depth 20.

Entry schema (any subset of keys):
    {
        "db":          [(shot_id, {field: old_value, ...}), ...],  # direct DB writes
        "reorder_ids": [shot_id, ...],                             # restore old order
        "purge":       [{"id", "name", "scene_name"}, ...],        # hard-delete these (inverse of create/duplicate)
        "queue":       [(command, params), ...],                   # queued main-thread commands
    }
"""
from collections import deque

_stack = deque(maxlen=20)


def push(label, entry):
    _stack.append({"label": label, "entry": entry})


def pop():
    return _stack.pop() if _stack else None


def depth():
    return len(_stack)


def peek_label():
    return _stack[-1]["label"] if _stack else None
