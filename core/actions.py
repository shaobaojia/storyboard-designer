"""HTTP API business logic — one function per endpoint.

server.py owns routing/transport only; every side effect (DB writes, file
saves, queue dispatch) lives here so handlers stay one-liners and the logic
can be unit-tested without HTTP. Each function returns (payload, status).
"""
import base64
import importlib
import json
import os
import re

from core.db import (
    get_db_version, create_shot, update_shot, delete_shot, get_shot,
    get_all_shots, reorder_shots, name_exists, next_c_name, next_c_number
)
from core.paths import shot_dir


def _queue(command, params):
    """Queue a command, always resolving core.queue fresh from sys.modules.

    Survives hot reloads: the module-level 'import core.queue' binding goes
    stale after 'del sys.modules[...]' reloads, so we re-import per call.
    """
    queue_mod = importlib.import_module("core.queue")
    queue_mod.queue_command(command, params)


# ---------- queries ----------

def list_shots(db_path):
    return {"status": "ok", "shots": get_all_shots(db_path)}, 200


def get_version(db_path):
    """Heartbeat payload: DB-content version marker + recent queue errors."""
    queue_mod = importlib.import_module("core.queue")
    return {
        "status": "ok",
        "version": get_db_version(db_path),
        "errors": queue_mod.recent_errors(),
    }, 200


def get_next_name(db_path):
    return {"status": "ok", "name": next_c_name(db_path)}, 200


def get_project(project_dir):
    """Blend file name, derived from the project dir ({blend}_storyboard)."""
    base = os.path.basename(project_dir.rstrip("/\\"))
    suffix = "_storyboard"
    name = base[:-len(suffix)] if base.endswith(suffix) else base
    return {"status": "ok", "name": name}, 200


def get_shot_by_id(db_path, shot_id):
    shot = get_shot(db_path, shot_id)
    if not shot:
        return {"status": "error", "message": "not found"}, 404
    return {"status": "ok", "shot": shot}, 200


# ---------- mutations ----------

def create_shot_action(project_dir, db_path, data):
    name = data.get("name") or next_c_name(db_path)
    if name_exists(db_path, name):
        return {"status": "error", "message": f"name taken: {name}"}, 409
    scene_name = f"Shot_{name}"
    shot_id = create_shot(db_path, name, scene_name,
                          camera=f"Cam_{name}",
                          duration=data.get("duration", 2.0))
    os.makedirs(shot_dir(project_dir, name, shot_id), exist_ok=True)
    try:
        _queue("create_shot_scene", {
            "shot_name": name,
            "scene_name": scene_name,
            "shot_id": shot_id,
            "project_dir": project_dir,
        })
        print(f"[Storyboard] Queued create_shot_scene for {name}")
    except Exception as e:
        print(f"[Storyboard] Queue error: {e}")
        import traceback
        traceback.print_exc()
    return {"status": "ok", "id": shot_id}, 200


def create_image_shots_action(project_dir, db_path, data):
    """Create shot(s) from dropped external images.
    data: {items: [{name, duration, filename, data_base64}]}"""
    results = []
    for item in data.get("items", []):
        name = item.get("name") or next_c_name(db_path)
        if name_exists(db_path, name):
            results.append({"name": name, "status": "error", "message": "name taken"})
            continue
        scene_name = f"Shot_{name}"
        shot_id = create_shot(db_path, name, scene_name,
                              camera=f"Cam_{name}",
                              duration=item.get("duration", 2.0))
        dir_path = shot_dir(project_dir, name, shot_id)
        os.makedirs(dir_path, exist_ok=True)
        # Save source image into the shot directory
        filename = item.get("filename") or "source.png"
        img_path = os.path.join(dir_path, os.path.basename(filename))
        try:
            raw = base64.b64decode(item.get("data_base64", ""))
            with open(img_path, "wb") as f:
                f.write(raw)
        except Exception as e:
            print(f"[Storyboard] Image save failed: {e}")
            img_path = None
        _queue("create_image_shot_scene", {
            "shot_name": name,
            "scene_name": scene_name,
            "image_path": img_path,
            "shot_id": shot_id,
            "project_dir": project_dir,
        })
        results.append({"name": name, "status": "ok", "id": shot_id})
    return {"status": "ok", "results": results}, 200


def sync_action():
    _queue("sync_scenes", {})
    return {"status": "ok", "message": "queued"}, 200


def reorder_action(db_path, data):
    reorder_shots(db_path, data.get("shot_ids", []))
    return {"status": "ok"}, 200


def batch_action(project_dir, db_path, data):
    """Batch ops on a set of shots: delete / rerender / duplicate / rename_seq."""
    action = data.get("action", "")
    shot_ids = data.get("shot_ids", [])
    done, errors = 0, []

    if action == "rename_seq":
        return _batch_rename_seq(project_dir, db_path, shot_ids)

    # Pre-allocate c-numbers locally. DB records are created asynchronously
    # by the queue, so re-querying per iteration would hand out the SAME
    # name every time (v0.2.0 bug).
    next_num = next_c_number(db_path)
    for sid in shot_ids:
        shot = get_shot(db_path, sid)
        if not shot:
            errors.append(f"{sid}: not found")
            continue
        try:
            if action == "delete":
                delete_shot(db_path, sid)
                _queue("delete_shot", {
                    "scene_name": shot["scene_name"],
                    "shot_name": shot["name"],
                    "shot_id": sid,
                    "project_dir": project_dir,
                })
            elif action == "rerender":
                _queue("rerender_shot", {
                    "scene_name": shot["scene_name"],
                    "shot_id": sid,
                    "project_dir": project_dir,
                })
            elif action == "duplicate":
                new_name = f"c{next_num:04d}"
                next_num += 10
                _queue("duplicate_shot", {
                    "scene_name": shot["scene_name"],
                    "new_name": new_name,
                    "project_dir": project_dir,
                })
            else:
                return {"status": "error", "message": "unknown action"}, 400
            done += 1
        except Exception as e:
            errors.append(f"{shot['name']}: {e}")

    return {"status": "ok", "done": done, "errors": errors}, 200


def _batch_rename_seq(project_dir, db_path, shot_ids):
    """Renumber a selection into the c-series: the first shot's trailing
    number (rounded down to a multiple of 10) is the base, +10 each, and
    names already taken outside the selection are skipped.

    Two-phase rename: phase 1 moves every shot to a unique temp name, phase 2
    lands them on the finals. Otherwise a target name still owned by a later
    shot in the selection makes cmd_rename_shot raise "Scene already exists".
    """
    ordered = [get_shot(db_path, sid) for sid in shot_ids]
    ordered = [s for s in ordered if s]
    if not ordered:
        return {"status": "ok", "done": 0, "errors": []}, 200

    m = re.search(r"(\d+)$", ordered[0]["name"] or "")
    base = int(m.group(1)) if m else 10
    base = max(10, (base // 10) * 10)
    selected_names = {s["name"] for s in ordered}

    n = base
    assignments = []
    for shot in ordered:
        while True:
            candidate = f"c{n:04d}"
            n += 10
            if candidate in selected_names:
                break  # freeing this name anyway, safe
            if not name_exists(db_path, candidate, exclude_id=shot["id"]):
                break  # free name
        if candidate != shot["name"]:
            assignments.append((shot, candidate))

    for shot, candidate in assignments:
        _queue("rename_shot", {
            "shot_id": shot["id"],
            "old_name": shot["name"],
            "new_name": f"__ren_{shot['id']}",
            "project_dir": project_dir,
        })
    for shot, candidate in assignments:
        _queue("rename_shot", {
            "shot_id": shot["id"],
            "old_name": f"__ren_{shot['id']}",
            "new_name": candidate,
            "project_dir": project_dir,
        })
    return {"status": "ok", "done": len(assignments), "errors": []}, 200


# ---------- per-shot actions ----------

def shot_action(project_dir, db_path, shot_id, data):
    action = data.get("action", "")

    if action == "update":
        update_shot(db_path, shot_id, **data.get("fields", {}))
        return {"status": "ok"}, 200

    # All actions below need the shot record
    shot = get_shot(db_path, shot_id)
    if not shot:
        return {"status": "error", "message": "not found"}, 404

    if action == "rename":
        new_name = (data.get("new_name") or "").strip()
        if not new_name:
            return {"status": "error", "message": "empty name"}, 400
        if new_name == shot["name"]:
            return {"status": "ok", "message": "unchanged"}, 200
        if name_exists(db_path, new_name, exclude_id=shot_id):
            return {"status": "error", "message": f"name taken: {new_name}"}, 409
        _queue("rename_shot", {
            "shot_id": shot_id,
            "old_name": shot["name"],
            "new_name": new_name,
            "project_dir": project_dir,
        })
        return {"status": "ok", "message": "queued"}, 200

    elif action == "set_background":
        # Drop image onto a card: save to shot dir, set as the shot camera's
        # background (100% opacity), auto-render.
        filename = os.path.basename(data.get("filename") or "background.png")
        dir_path = shot_dir(project_dir, shot["name"], shot_id)
        os.makedirs(dir_path, exist_ok=True)
        img_path = os.path.join(dir_path, filename)
        try:
            raw = base64.b64decode(data.get("data_base64", ""))
            with open(img_path, "wb") as f:
                f.write(raw)
        except Exception as e:
            return {"status": "error", "message": f"save failed: {e}"}, 500
        _queue("set_camera_background", {
            "scene_name": shot["scene_name"],
            "image_path": img_path,
            "shot_id": shot_id,
            "shot_name": shot["name"],
            "project_dir": project_dir,
        })
        return {"status": "ok", "message": "queued"}, 200

    elif action == "delete":
        delete_shot(db_path, shot_id)
        _queue("delete_shot", {
            "scene_name": shot["scene_name"],
            "shot_name": shot["name"],
            "shot_id": shot_id,
            "project_dir": project_dir,
        })
        return {"status": "ok"}, 200

    elif action == "open":
        _queue("open_shot", {"scene_name": shot["scene_name"]})
        return {"status": "ok", "message": "queued"}, 200

    elif action == "rerender":
        _queue("rerender_shot", {
            "scene_name": shot["scene_name"],
            "shot_id": shot_id,
            "project_dir": project_dir,
        })
        return {"status": "ok", "message": "queued"}, 200

    elif action == "duplicate":
        new_name = data.get("new_name") or next_c_name(db_path)
        _queue("duplicate_shot", {
            "scene_name": shot["scene_name"],
            "new_name": new_name,
            "project_dir": project_dir,
        })
        return {"status": "ok", "message": "queued", "new_name": new_name}, 200

    return {"status": "error", "message": "unknown action"}, 400
