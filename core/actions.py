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
import uuid

from core import undo
from core.db import (
    get_db_version, create_shot, update_shot, delete_shot, get_shot,
    get_all_shots, get_trash, reorder_shots, name_exists, next_c_name, next_c_number,
    get_all_frames, get_frames, set_cover_frame,
)
from core.paths import shot_dir


def _queue(command, params):
    """Queue a command, always resolving core.queue fresh from sys.modules.

    Survives hot reloads: the module-level 'import core.queue' binding goes
    stale after 'del sys.modules[...]' reloads, so we re-import per call.
    """
    queue_mod = importlib.import_module("core.queue")
    queue_mod.queue_command(command, params)


def _cover_frame_no(db_path, shot_id):
    """封面帧号（懒加载 core.queue，兼容热重载）。无帧行兜底 0。"""
    queue_mod = importlib.import_module("core.queue")
    return queue_mod._cover_frame_no(db_path, shot_id)


# ---------- queries ----------

def _shot_dir_name(shot):
    return f"{shot['name']}_{shot['id']}"


def _frame_to_api(frame, shot, project_dir):
    """Shape one frames row for the web: imageUrl with cache-busting version,
    null when the image is missing (red-cell fallback on the front end).

    Cache stamp is the FRAME-level `ver` (bumped on every re-render of this
    frame) — shot.thumb_ver only tracks the cover/thumbnail, so non-cover
    re-renders would keep the same URL and the browser would serve the stale
    image."""
    img = frame.get("image_path")
    if img and os.path.exists(img):
        rel = os.path.basename(img)
        url = f"/shots/{_shot_dir_name(shot)}/{rel}?v={frame.get('ver') or 0}"
    else:
        url = None
    return {
        "id": frame["id"],
        "frame_no": frame["frame_no"],
        "imageUrl": url,
        "isCover": bool(frame["is_cover"]),
    }


def _attach_frames(shots, db_path, project_dir):
    """Nest frames[] into each shot dict (multi-image contract, v0.7.0)."""
    grouped = get_all_frames(db_path)
    for shot in shots:
        frames = grouped.get(shot["id"], [])
        shot["frames"] = [_frame_to_api(f, shot, project_dir) for f in frames]
    return shots


def list_shots(db_path, project_dir):
    shots = get_all_shots(db_path)
    return {"status": "ok", "shots": _attach_frames(shots, db_path, project_dir)}, 200


def get_version(db_path):
    """Heartbeat payload: DB-content version marker + recent queue errors
    + trash count / undo depth for the corner badges."""
    queue_mod = importlib.import_module("core.queue")
    return {
        "status": "ok",
        "version": get_db_version(db_path),
        "errors": queue_mod.recent_errors(),
        "trash_count": len(get_trash(db_path)),
        "undo_label": undo.peek_label(),
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


def list_trash(db_path):
    return {"status": "ok", "shots": get_trash(db_path)}, 200


# ---------- undo ----------

def undo_action(project_dir, db_path):
    """Pop the undo stack and replay the inverse entry."""
    item = undo.pop()
    if not item:
        return {"status": "empty"}, 200
    e = item["entry"]
    try:
        for shot_id, fields in e.get("db", []):
            update_shot(db_path, shot_id, **fields)
        if e.get("reorder_ids"):
            reorder_shots(db_path, e["reorder_ids"])
        for s in e.get("purge", []):
            delete_shot(db_path, s["id"])
            _queue("delete_shot", {
                "scene_name": s["scene_name"], "shot_name": s["name"],
                "shot_id": s["id"], "project_dir": project_dir,
            })
        for cmd, params in e.get("queue", []):
            _queue(cmd, params)
    except Exception as ex:
        return {"status": "error", "message": str(ex)}, 500
    return {"status": "ok", "label": item["label"]}, 200


# ---------- mutations ----------

def _trash_one(project_dir, db_path, shot):
    """Soft delete one shot: DB deleted=1 + scene parked under __trash__.
    Returns the undo entry that would restore it."""
    trash_scene = f"__trash__{shot['scene_name']}"
    update_shot(db_path, shot["id"], deleted=1, scene_name=trash_scene)
    _queue("trash_shot", {"scene_name": shot["scene_name"], "trash_scene_name": trash_scene})
    return {
        "db": [(shot["id"], {"deleted": 0, "scene_name": shot["scene_name"]})],
        "queue": [("restore_shot", {"trash_scene_name": trash_scene,
                                    "scene_name": shot["scene_name"]})],
    }

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
            "duration": data.get("duration", 2.0),
        })
        print(f"[Storyboard] Queued create_shot_scene for {name}")
    except Exception as e:
        print(f"[Storyboard] Queue error: {e}")
        import traceback
        traceback.print_exc()
    undo.push(f"新建 {name}", {"purge": [{"id": shot_id, "name": name, "scene_name": scene_name}]})
    return {"status": "ok", "id": shot_id}, 200


def create_image_shots_action(project_dir, db_path, data):
    """Create shot(s) from dropped external images.
    data: {items: [{name, duration, filename, data_base64}]}"""
    results = []
    created = []
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
        created.append({"id": shot_id, "name": name, "scene_name": scene_name})
    if created:
        undo.push(f"新建 {len(created)} 个图片镜头", {"purge": created})
    return {"status": "ok", "results": results}, 200


def sync_action():
    _queue("sync_scenes", {})
    return {"status": "ok", "message": "queued"}, 200


def reorder_action(db_path, data):
    old_ids = [s["id"] for s in get_all_shots(db_path)]
    reorder_shots(db_path, data.get("shot_ids", []))
    undo.push("拖拽排序", {"reorder_ids": old_ids})
    return {"status": "ok"}, 200


def _duplicate_one(project_dir, db_path, shot, new_name):
    """Queue one duplicate: copy lands right after the source, undo = purge it."""
    new_id = uuid.uuid4().hex[:8]
    _queue("duplicate_shot", {
        "scene_name": shot["scene_name"],
        "new_name": new_name,
        "project_dir": project_dir,
        "shot_id": new_id,
        "after_id": shot["id"],
    })
    undo.push(f"复制 {shot['name']}", {
        "purge": [{"id": new_id, "name": new_name, "scene_name": f"Shot_{new_name}"}]
    })
    return new_name


def batch_action(project_dir, db_path, data):
    """Batch ops on a set of shots: delete / rerender / duplicate / rename_seq / purge."""
    action = data.get("action", "")
    shot_ids = data.get("shot_ids", [])
    done, errors = 0, []

    if action == "rename_seq":
        return _batch_rename_seq(project_dir, db_path, shot_ids)

    if action == "restore":
        # Batch restore from the trash bin; one grouped undo entry (re-trash all)
        inv_db, inv_queue = [], []
        for sid in shot_ids:
            shot = get_shot(db_path, sid)
            if not shot or not shot.get("deleted"):
                continue
            orig_scene = shot["scene_name"].replace("__trash__", "", 1)
            if name_exists(db_path, shot["name"], exclude_id=sid):
                errors.append(f"{shot['name']}: name taken")
                continue
            update_shot(db_path, sid, deleted=0, scene_name=orig_scene)
            _queue("restore_shot", {
                "trash_scene_name": shot["scene_name"],
                "scene_name": orig_scene,
            })
            inv_db.append((sid, {"deleted": 1, "scene_name": shot["scene_name"]}))
            inv_queue.append(("trash_shot", {
                "scene_name": orig_scene,
                "trash_scene_name": shot["scene_name"],
            }))
            done += 1
        if inv_db:
            undo.push(f"批量恢复 {done} 个镜头", {"db": inv_db, "queue": inv_queue})
        return {"status": "ok", "done": done, "errors": errors}, 200

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
                undo.push(f"删除 {shot['name']}", _trash_one(project_dir, db_path, shot))
            elif action == "purge":
                delete_shot(db_path, sid)
                _queue("delete_shot", {
                    "scene_name": shot["scene_name"],
                    "shot_name": shot["name"],
                    "shot_id": sid,
                    "project_dir": project_dir,
                })
            elif action == "rerender":
                # v0.8.4：重渲染 = 重拍封面帧（统一 frames 模型，等价旧 RenderShot）
                _queue("render_frame", {
                    "scene_name": shot["scene_name"],
                    "shot_id": sid,
                    "project_dir": project_dir,
                    "frame_no": _cover_frame_no(db_path, sid),
                })
            elif action == "duplicate":
                new_name = f"c{next_num:04d}"
                next_num += 10
                _duplicate_one(project_dir, db_path, shot, new_name)
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
    # Undo: same two-phase dance in reverse
    inv = []
    for shot, candidate in assignments:
        inv.append(("rename_shot", {
            "shot_id": shot["id"], "old_name": candidate,
            "new_name": f"__un_{shot['id']}", "project_dir": project_dir,
        }))
    for shot, candidate in assignments:
        inv.append(("rename_shot", {
            "shot_id": shot["id"], "old_name": f"__un_{shot['id']}",
            "new_name": shot["name"], "project_dir": project_dir,
        }))
    if inv:
        undo.push(f"批量重命名 {len(assignments)} 个镜头", {"queue": inv})
    return {"status": "ok", "done": len(assignments), "errors": []}, 200


# ---------- per-shot actions ----------

def shot_action(project_dir, db_path, shot_id, data):
    action = data.get("action", "")

    if action == "update":
        fields = data.get("fields", {})
        old = get_shot(db_path, shot_id)
        if not old:
            return {"status": "error", "message": "not found"}, 404
        update_shot(db_path, shot_id, **fields)
        old_fields = {k: old[k] for k in fields if k in old}
        if old_fields:
            undo.push(f"修改 {old['name']}", {"db": [(shot_id, old_fields)]})
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
        undo.push(f"改名 {shot['name']}→{new_name}", {
            "queue": [("rename_shot", {
                "shot_id": shot_id, "old_name": new_name,
                "new_name": shot["name"], "project_dir": project_dir,
            })]
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
        # Soft delete: shot goes to the trash bin (restorable, undoable)
        undo.push(f"删除 {shot['name']}", _trash_one(project_dir, db_path, shot))
        return {"status": "ok"}, 200

    elif action == "restore":
        # Back from the trash bin
        if not shot.get("deleted"):
            return {"status": "ok", "message": "not in trash"}, 200
        orig_scene = shot["scene_name"].replace("__trash__", "", 1)
        if name_exists(db_path, shot["name"], exclude_id=shot_id):
            return {"status": "error", "message": f"name taken: {shot['name']}"}, 409
        update_shot(db_path, shot_id, deleted=0, scene_name=orig_scene)
        _queue("restore_shot", {
            "trash_scene_name": shot["scene_name"],
            "scene_name": orig_scene,
        })
        # Restoring is itself undoable (inverse = trash it again)
        undo.push(f"恢复 {shot['name']}", {
            "db": [(shot_id, {"deleted": 1, "scene_name": shot["scene_name"]})],
            "queue": [("trash_shot", {"scene_name": orig_scene,
                                      "trash_scene_name": shot["scene_name"]})],
        })
        return {"status": "ok"}, 200

    elif action == "purge":
        # Permanent delete from the trash bin — NOT undoable
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
        # v0.8.4：重渲染 = 重拍封面帧（统一 frames 模型，等价旧 RenderShot）
        _queue("render_frame", {
            "scene_name": shot["scene_name"],
            "shot_id": shot_id,
            "project_dir": project_dir,
            "frame_no": _cover_frame_no(db_path, shot_id),
        })
        return {"status": "ok", "message": "queued"}, 200

    elif action == "duplicate":
        new_name = data.get("new_name") or next_c_name(db_path)
        new_name = _duplicate_one(project_dir, db_path, shot, new_name)
        return {"status": "ok", "message": "queued", "new_name": new_name}, 200

    # ---------- multi-frame actions (v0.7.0) ----------

    elif action == "render_frame":
        # 拍屏指定帧（新增帧或重拍同帧，覆盖由后端 upsert 处理）
        frame_no = data.get("frame_no")
        if frame_no is None:
            return {"status": "error", "message": "frame_no required"}, 400
        _queue("render_frame", {
            "scene_name": shot["scene_name"],
            "shot_id": shot_id,
            "project_dir": project_dir,
            "frame_no": int(frame_no),
        })
        return {"status": "ok", "message": "queued"}, 200

    elif action == "set_cover":
        frame_id = data.get("frame_id")
        if not frame_id:
            return {"status": "error", "message": "frame_id required"}, 400
        _queue("set_cover_frame", {
            "shot_id": shot_id,
            "frame_id": frame_id,
            "project_dir": project_dir,
        })
        return {"status": "ok", "message": "queued"}, 200

    elif action == "jump_to_frame":
        # 跳回构图：切 Scene + 时间轴跳帧
        frame_no = data.get("frame_no")
        if frame_no is None:
            return {"status": "error", "message": "frame_no required"}, 400
        _queue("jump_to_frame", {
            "scene_name": shot["scene_name"],
            "frame_no": int(frame_no),
        })
        return {"status": "ok", "message": "queued"}, 200

    elif action == "delete_frame":
        frame_id = data.get("frame_id")
        if not frame_id:
            return {"status": "error", "message": "frame_id required"}, 400
        _queue("delete_frame", {
            "shot_id": shot_id,
            "frame_id": frame_id,
            "project_dir": project_dir,
        })
        return {"status": "ok", "message": "queued"}, 200

    return {"status": "error", "message": "unknown action"}, 400
