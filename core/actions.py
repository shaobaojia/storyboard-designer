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
    get_all_shots, get_trash, get_other_scenes, reorder_shots, name_exists,
    next_c_name, next_c_number, get_all_frames, get_frames, set_cover_frame,
)
from core.paths import shot_dir

# v0.9.6 镜头名白名单：防路径穿越（.. / \ : * ? " < > |）+ Windows 保留名
_INVALID_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_WIN_RESERVED = {"CON", "PRN", "AUX", "NUL",
                 *(f"COM{i}" for i in range(1, 10)),
                 *(f"LPT{i}" for i in range(1, 10))}

def _valid_shot_name(name):
    """校验镜头名可安全用作目录名/场景名。返回 (ok, reason)。"""
    if not name or not isinstance(name, str):
        return False, "name required"
    if _INVALID_NAME_CHARS.search(name):
        return False, "name contains illegal characters"
    if ".." in name:
        return False, "name contains '..'"
    if name.strip() != name or name.endswith("."):
        return False, "name has leading/trailing space or trailing dot"
    if name.upper() in _WIN_RESERVED:
        return False, "name is a Windows reserved name"
    return True, ""


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
    """主宫格数据源：只返回分镜系统创建的镜头（origin='storyboard'）。
    手动/幽灵等其它场景走 /api/other_scenes（「其它」页，v0.9.25）。"""
    shots = [s for s in get_all_shots(db_path)
             if (s.get("origin") or "storyboard") == "storyboard"]
    return {"status": "ok", "shots": _attach_frames(shots, db_path, project_dir)}, 200


def list_other_scenes(db_path):
    """「其它」页面数据源：所有 origin='other' 的非镜头场景
    （手动在 Blender 创建 / 幽灵场景 / 其它非插件途径）。"""
    return {"status": "ok", "scenes": get_other_scenes(db_path)}, 200


def other_scene_action(project_dir, db_path, data):
    """「其它」场景操作：
    - adopt：转为正式镜头（决策 A1：统一 c 编号；无相机自动补默认）
    - delete：硬删场景（决策 B1：直接删不进垃圾桶，不可撤销，前端需确认）
    body: {action, scene_name, duration?}"""
    action = data.get("action", "")
    scene_name = data.get("scene_name") or ""
    if not scene_name or not isinstance(scene_name, str) or len(scene_name) > 128:
        return {"status": "error", "message": "scene_name required"}, 400
    if "/" in scene_name or "\\" in scene_name or ".." in scene_name:
        return {"status": "error", "message": "invalid scene_name"}, 400

    shot = next((s for s in get_other_scenes(db_path)
                 if s["scene_name"] == scene_name), None)
    if not shot:
        return {"status": "error", "message": f"scene not found: {scene_name}"}, 404

    if action == "adopt":
        # 编号：next_c_name 基于 DB（含垃圾桶）；场景层撞名（正名幽灵/手动 Shot_cXXXX）
        # 由 queue 命令主线程兜底 +10 重试
        new_name = next_c_name(db_path)
        _queue("adopt_other_scene", {
            "scene_name": scene_name,
            "shot_id": shot["id"],
            "new_name": new_name,
            "project_dir": project_dir,
            "duration": data.get("duration", 2.0),
        })
        # undo：还原为其它场景（场景名改回原名 + DB 还原 origin/name/scene_name/camera）
        undo.push(f"转为镜头 {shot['name']}", {
            "db": [(shot["id"], {"name": shot["name"], "scene_name": shot["scene_name"],
                                 "camera": shot.get("camera") or "", "origin": "other"})],
            "queue": [("rename_scene", {"scene_name": f"Shot_{new_name}",
                                        "new_name": shot["scene_name"]})],
        })
        return {"status": "ok", "message": "queued", "new_name": new_name}, 200

    if action == "delete":
        # 硬删：DB 先删（queue 失败回滚重建记录，场景还在），再 queue 删场景
        delete_shot(db_path, shot["id"])
        try:
            _queue("delete_other_scene", {"scene_name": scene_name})
        except Exception:
            from core.db import create_shot as _re_create
            _re_create(db_path, shot["name"], shot["scene_name"],
                       camera=shot.get("camera") or "", origin="other",
                       shot_id=shot["id"])
            raise
        return {"status": "ok", "message": "queued"}, 200

    return {"status": "error", "message": "unknown action"}, 400


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


def _read_project_json(project_dir):
    """project.json 读盘（坏文件/缺字段静默兜底 {}）——画幅比/分辨率的持久化载体。"""
    try:
        with open(os.path.join(project_dir, "project.json"), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def get_project(project_dir):
    """Blend file name + 项目分辨率/画幅比（v0.9.7：前端画幅显示的权威来源）。"""
    base = os.path.basename(project_dir.rstrip("/\\"))
    suffix = "_storyboard"
    name = base[:-len(suffix)] if base.endswith(suffix) else base
    pj = _read_project_json(project_dir)
    rx = int(pj.get("resolution_x") or 1920)
    ry = int(pj.get("resolution_y") or 1080)
    return {"status": "ok", "name": name,
            "resolution_x": rx, "resolution_y": ry,
            "aspect": rx / ry if ry > 0 else 16 / 9}, 200


def set_project_resolution(project_dir, db_path, data):
    """画幅比/分辨率设置（对话框确定）：写 project.json + queue 主线程改所有 scene。
    决策 B：宽高直改（scene resolution_x/y = 输入值），画幅比 = w/h 推导。"""
    try:
        w = int(data.get("width"))
        h = int(data.get("height"))
    except (TypeError, ValueError):
        return {"status": "error", "message": "width/height 必须是整数"}, 400
    if not (16 <= w <= 16384 and 16 <= h <= 16384):
        return {"status": "error", "message": "宽/高需在 16~16384 之间"}, 400
    pj = _read_project_json(project_dir)
    pj["resolution_x"] = w
    pj["resolution_y"] = h
    pj["aspect_ratio"] = w / h
    try:
        with open(os.path.join(project_dir, "project.json"), "w", encoding="utf-8") as f:
            json.dump(pj, f, indent=2, ensure_ascii=False)
    except Exception as e:
        return {"status": "error", "message": f"写 project.json 失败: {e}"}, 500
    # 主线程遍历所有 scene 改渲染分辨率（queue 失败回滚 project.json，v0.9.6 非原子模式）
    try:
        _queue("set_project_resolution", {"width": w, "height": h})
    except Exception as e:
        try:
            pj.pop("resolution_x", None); pj.pop("resolution_y", None); pj.pop("aspect_ratio", None)
            with open(os.path.join(project_dir, "project.json"), "w", encoding="utf-8") as f:
                json.dump(pj, f, indent=2, ensure_ascii=False)
        except Exception:
            pass
        return {"status": "error", "message": f"应用分辨率失败: {e}"}, 500
    return {"status": "ok", "resolution_x": w, "resolution_y": h, "aspect": w / h}, 200


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
    try:
        _queue("trash_shot", {"scene_name": shot["scene_name"], "trash_scene_name": trash_scene})
    except Exception:
        # v0.9.6：queue 失败回滚 DB（否则 DB 说已删但场景没改名，状态分裂）
        update_shot(db_path, shot["id"], deleted=0, scene_name=shot["scene_name"])
        raise
    return {
        "db": [(shot["id"], {"deleted": 0, "scene_name": shot["scene_name"]})],
        "queue": [("restore_shot", {"trash_scene_name": trash_scene,
                                    "scene_name": shot["scene_name"]})],
    }

def create_shot_action(project_dir, db_path, data):
    name = data.get("name") or next_c_name(db_path)
    if name_exists(db_path, name):
        return {"status": "error", "message": f"name taken: {name}"}, 409
    ok, reason = _valid_shot_name(name)  # v0.9.6：非法名拒绝（路径穿越/非法字符会炸 makedirs）
    if not ok:
        return {"status": "error", "message": f"invalid name: {reason}"}, 400
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
        ok, reason = _valid_shot_name(name)  # v0.9.6：非法名拒绝
        if not ok:
            results.append({"name": name, "status": "error", "message": f"invalid name: {reason}"})
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

    elif action == "move_dialogue":
        # v0.9.68：台词移动/互换原子化——原前端两次独立 update 各 push 一条 undo，
        # 一次撤销只回放一条 → 移动后撤销台词消失（需求池 474 行 bug 实测复现）。
        # 现在：一次写两个镜头 + 单条 undo entry（db 两条记录，undo_action 一次回放全恢复）
        dst_id = data.get("dst_id", "")
        if not dst_id or dst_id == shot_id:
            return {"status": "error", "message": "invalid dst_id"}, 400
        src = get_shot(db_path, shot_id)
        if not src:
            return {"status": "error", "message": "not found"}, 404
        dst = get_shot(db_path, dst_id)
        if not dst:
            return {"status": "error", "message": "dst not found"}, 404
        src_text = src.get("dialogue") or ""
        dst_text = dst.get("dialogue") or ""
        swap = bool(dst_text and dst_text.strip())
        try:
            update_shot(db_path, shot_id, dialogue=(dst_text if swap else ""))
            update_shot(db_path, dst_id, dialogue=src_text)
        except Exception as ex:
            # 第二个写失败 → 回滚第一个写，保持两镜头一致
            update_shot(db_path, shot_id, dialogue=src_text)
            return {"status": "error", "message": f"write failed: {ex}"}, 500
        undo.push(f"{'互换' if swap else '移动'}台词 {src['name']}→{dst['name']}", {
            "db": [(shot_id, {"dialogue": src_text}), (dst_id, {"dialogue": dst_text})],
        })
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
        ok, reason = _valid_shot_name(new_name)  # v0.9.6：非法名拒绝（rename 四层联动含目录改名）
        if not ok:
            return {"status": "error", "message": f"invalid name: {reason}"}, 400
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
        try:
            _queue("restore_shot", {
                "trash_scene_name": shot["scene_name"],
                "scene_name": orig_scene,
            })
        except Exception:
            # v0.9.6：queue 失败回滚 DB（否则 DB 说已恢复但场景没改回来）
            update_shot(db_path, shot_id, deleted=1, scene_name=shot["scene_name"])
            raise
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
        try:
            _queue("delete_shot", {
                "scene_name": shot["scene_name"],
                "shot_name": shot["name"],
                "shot_id": shot_id,
                "project_dir": project_dir,
            })
        except Exception:
            # v0.9.6：queue 失败回滚 DB（否则 DB 已删但场景还在，孤儿场景）
            from core.db import create_shot as _re_create
            _re_create(db_path, shot["name"], shot["scene_name"],
                       camera=shot.get("camera", ""), duration=shot.get("duration", 2.0),
                       shot_id=shot_id)
            raise
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
