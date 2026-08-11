"""
Frame-operation commands for Storyboard Designer (v0.9.73 split from core.queue).

主线程队列命令的帧操作域（render_frame / set_cover_frame / delete_frame）。
依赖方向：本模块只依赖 core 叶子模块（db/render），不 import core.queue ——
queue.py import 本模块填 COMMANDS 注册表，反向 import 会成环。
"""
import os
import bpy
from core.db import (get_db_path, get_all_shots, get_frames, add_frame,
                     update_frame, update_shot, delete_frame,
                     set_cover_frame)
from core.render import render_shot_files


def _switch_scene(scene):
    """Switch active scene, return previous scene for restore. Window may be None."""
    prev = None
    try:
        if bpy.context.window:
            prev = bpy.context.window.scene
            bpy.context.window.scene = scene
    except Exception:
        pass
    return prev


def _restore_scene(prev):
    try:
        if prev and bpy.context.window:
            bpy.context.window.scene = prev
    except Exception:
        pass


def cmd_render_frame(params):
    """Render one frame of a multi-frame shot: jump timeline to frame_no,
    OpenGL 拍屏, write fNNNNN_still.jpg / fNNNNN_thumb.jpg, upsert the
    frames row, and refresh shots.thumb_* if this frame is (or becomes) the
    cover. Creates the frames row if it doesn't exist yet (add-frame flow);
    overwrites the existing row's image_path on re-render."""
    scene_name = params.get("scene_name")
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")
    frame_no = int(params.get("frame_no"))

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")
    if not scene.camera:
        raise ValueError("No camera in scene")

    db_path = get_db_path(project_dir)
    shot = next((s for s in get_all_shots(db_path) if s["id"] == shot_id), None)
    shot_name = shot["name"] if shot else shot_id
    shot_dir = os.path.join(project_dir, "shots", f"{shot_name}_{shot_id}")

    prev = _switch_scene(scene)
    try:
        paths = render_shot_files(scene, shot_dir, frame_no=frame_no)
    finally:
        _restore_scene(prev)

    # Upsert frames row: same frame_no exists → overwrite image_path; else add
    frames = get_frames(db_path, shot_id)
    existing = next((f for f in frames if f["frame_no"] == frame_no), None)
    if existing:
        update_frame(db_path, existing["id"], image_path=paths["thumb_path"])
        frame_id = existing["id"]
        is_cover = bool(existing["is_cover"])
    else:
        # First frame of a shot becomes cover by default
        is_cover = len(frames) == 0
        frame_id = add_frame(db_path, shot_id, frame_no,
                             image_path=paths["thumb_path"], is_cover=is_cover)

    # Cover frame → sync the shot-level thumb cache so collapsed card refreshes
    if is_cover:
        update_shot(db_path, shot_id,
                    still_path=paths["still_path"],
                    thumb_path=paths["thumb_path"],
                    thumb_fresh=True)

    return {"frame_id": frame_id, "frame_no": frame_no,
            "thumb": paths["thumb_path"], "is_cover": is_cover}


def cmd_set_cover_frame(params):
    """Mark a frame as cover and sync shots.thumb_* so the collapsed card
    and timeline show it. Pure DB + path copy, no rendering."""
    shot_id = params.get("shot_id")
    frame_id = params.get("frame_id")
    project_dir = params.get("project_dir")

    db_path = get_db_path(project_dir)
    frames = get_frames(db_path, shot_id)
    target = next((f for f in frames if f["id"] == frame_id), None)
    if not target:
        raise ValueError(f"Frame not found: {frame_id}")

    set_cover_frame(db_path, shot_id, frame_id)
    if target["image_path"]:
        # thumb cache points at the cover frame's image; still keeps the same
        # file (still/thumb pair) — bump thumb_ver so the web refreshes
        update_shot(db_path, shot_id,
                    thumb_path=target["image_path"],
                    thumb_fresh=True)
    return {"shot_id": shot_id, "frame_id": frame_id}


def cmd_delete_frame(params):
    """Delete one frame: DB row + disk files. If the deleted frame was the
    cover, promote the lowest-frame_no sibling to cover and sync thumb."""
    shot_id = params.get("shot_id")
    frame_id = params.get("frame_id")
    project_dir = params.get("project_dir")

    db_path = get_db_path(project_dir)
    frames = get_frames(db_path, shot_id)
    target = next((f for f in frames if f["id"] == frame_id), None)
    if not target:
        raise ValueError(f"Frame not found: {frame_id}")
    if len(frames) <= 1:
        raise ValueError("cannot delete the last frame of a shot")

    # Remove disk files (still + thumb pair), tolerate missing files
    # v0.9.71 去 png：v0.9.4 起拍屏统一 JPG，删帧只清 jpg 两候选
    if target["image_path"]:
        base = target["image_path"]
        for p in {base, base.replace("_thumb.jpg", "_still.jpg")}:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass

    was_cover = bool(target["is_cover"])
    delete_frame(db_path, frame_id)

    # Cover deleted → promote lowest frame_no sibling
    if was_cover:
        siblings = [f for f in frames if f["id"] != frame_id]
        siblings.sort(key=lambda f: f["frame_no"])
        new_cover = siblings[0]
        set_cover_frame(db_path, shot_id, new_cover["id"])
        if new_cover["image_path"]:
            update_shot(db_path, shot_id,
                        thumb_path=new_cover["image_path"],
                        thumb_fresh=True)
        return {"deleted": frame_id, "new_cover": new_cover["id"]}

    return {"deleted": frame_id}
