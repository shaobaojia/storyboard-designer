"""
Remote command queue for Storyboard Designer.
bpy operations must run in Blender's main thread.
HTTP requests arrive in background thread → queue → main thread timer consumes.
"""
import bpy
import queue
import threading
from collections import deque

# Thread-safe queue for remote commands
_command_queue = queue.Queue()
_timer_registered = False

# Recent command errors, surfaced to the web client via /api/version so a
# failed Blender-side operation shows up as a toast instead of vanishing
# into the Blender console.
_recent_errors = deque(maxlen=10)


def recent_errors():
    """Snapshot of recent command errors: [{command, error, ts}]."""
    return list(_recent_errors)


def queue_command(command, params, callback=None):
    """Queue a command for main thread execution. Timer must already be registered from main thread."""
    _command_queue.put({
        "command": command,
        "params": params,
        "callback": callback,
        "result": None,
        "error": None,
        "done": threading.Event(),
    })
    print(f"[Storyboard] Queued: {command}")


def ensure_timer():
    """Ensure the main thread timer is registered. Must be called from main thread!"""
    global _timer_registered
    if not _timer_registered:
        try:
            bpy.app.timers.register(process_queue, first_interval=0.1, persistent=True)
            _timer_registered = True
            print("[Storyboard] Timer registered")
        except Exception as e:
            print(f"[Storyboard] Failed to register timer: {e}")


def process_queue():
    """Process queued commands in main thread. Called by timer."""
    while not _command_queue.empty():
        try:
            cmd = _command_queue.get_nowait()
        except queue.Empty:
            break

        try:
            result = execute_command(cmd["command"], cmd["params"])
            cmd["result"] = result
            print(f"[Storyboard] Executed: {cmd['command']}")
        except Exception as e:
            cmd["error"] = str(e)
            print(f"[Storyboard] Command error: {e}")
            import traceback
            traceback.print_exc()
            from datetime import datetime
            _recent_errors.append({
                "command": cmd["command"],
                "error": str(e),
                "ts": datetime.now().isoformat(),
            })
        finally:
            cmd["done"].set()
            if cmd["callback"]:
                try:
                    cmd["callback"](cmd)
                except Exception:
                    pass

    return 0.03  # 30ms interval


def execute_command(command, params):
    """Execute a remote command in main thread (via the COMMANDS registry)."""
    entry = COMMANDS.get(command)
    if not entry:
        raise ValueError(f"Unknown command: {command}")
    fn, required = entry
    # 用 is None 而非 falsy：frame_no=0 是合法帧号，曾被误判缺参（v0.8.1）
    missing = [k for k in required if params.get(k) is None]
    if missing:
        raise ValueError(f"{command}: missing params {missing}")
    return fn(params)


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


def _cover_frame_no(db_path, shot_id):
    """封面帧号：多图模型下所有镜头都有 frames 行（v0.7.0 迁移保证）。
    无行时兜底 0（legacy 兼容）。"""
    from core.db import get_frames
    frames = get_frames(db_path, shot_id)
    cover = next((f for f in frames if f.get("is_cover")), None)
    return cover["frame_no"] if cover else 0


def _render_frame_of(db_path, shot, frame_no, project_dir):
    """按帧号渲染（cmd_render_frame 的同步调用版，供创建/拖图等主线程路径复用）。"""
    cmd_render_frame({
        "scene_name": shot["scene_name"],
        "shot_id": shot["id"],
        "project_dir": project_dir,
        "frame_no": frame_no,
    })


def cmd_open_shot(params):
    """Switch to shot's scene and camera view."""
    scene_name = params.get("scene_name")
    if not scene_name:
        raise ValueError("scene_name required")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")

    bpy.context.window.scene = scene

    # Switch to camera view in all 3D viewports
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.region_3d.view_perspective = 'CAMERA'

    return {"scene": scene_name, "camera": scene.camera.name if scene.camera else None}


def cmd_duplicate_shot(params):
    """Duplicate a shot's scene as a fully independent copy (not linked).
    Auto-renders the new shot afterwards (item: create-path auto 拍屏)."""
    scene_name = params.get("scene_name")
    new_name = params.get("new_name")
    project_dir = params.get("project_dir")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")

    # Full copy: independent data, not linked duplicate.
    target_name = f"Shot_{new_name}" if new_name else f"{scene_name}_copy"

    prev_active = None
    try:
        prev_active = bpy.context.window.scene if bpy.context.window else None
    except Exception:
        pass

    try:
        if bpy.context.window:
            bpy.context.window.scene = scene
        bpy.ops.scene.new(type='FULL_COPY')
        new_scene = bpy.context.window.scene if bpy.context.window else bpy.data.scenes[-1]
        new_scene.name = target_name
    except Exception:
        # Fallback (no window context): scene.copy() linked dup — shares data
        new_scene = scene.copy()
        new_scene.name = target_name
        if scene.camera:
            new_cam = scene.camera.copy()
            new_cam.data = scene.camera.data.copy()
            new_scene.collection.objects.link(new_cam)
            new_scene.camera = new_cam

    _restore_scene(prev_active)

    # Create DB record (shot_id pre-generated by caller for undo wiring)
    import os
    from core.db import get_db_path, create_shot, get_all_shots, reorder_shots

    db_path = get_db_path(project_dir)
    shot_id = create_shot(db_path, new_name, new_scene.name,
                          camera=new_scene.camera.name if new_scene.camera else "",
                          duration=2.0,
                          shot_id=params.get("shot_id"))

    shot_dir = os.path.join(project_dir, "shots", f"{new_name}_{shot_id}")
    os.makedirs(shot_dir, exist_ok=True)

    # The copy gets its OWN background image files: FULL_COPY shares the image
    # datablocks with the source, so purging/renaming the source would break
    # the copy's background (v0.6.1 bugfix, companion to the rename repoint).
    if new_scene.camera and new_scene.camera.data:
        import shutil as _shutil
        for bg in new_scene.camera.data.background_images:
            img = bg.image
            if not img or not img.filepath:
                continue
            try:
                src_p = bpy.path.abspath(img.filepath)
            except Exception:
                continue
            if not os.path.exists(src_p):
                continue
            dst_p = os.path.join(shot_dir, os.path.basename(src_p))
            try:
                if os.path.normpath(src_p) != os.path.normpath(dst_p):
                    _shutil.copy2(src_p, dst_p)
                bg.image = bpy.data.images.load(dst_p)
            except Exception as e:
                print(f"[Storyboard] Duplicate bg copy failed: {e}")

    # Insert the copy right after the source shot (not at the end)
    after_id = params.get("after_id")
    if after_id:
        shots = get_all_shots(db_path)
        ids = [s["id"] for s in shots if s["id"] != shot_id]
        try:
            at = ids.index(after_id) + 1
        except ValueError:
            at = len(ids)
        ids.insert(at, shot_id)
        reorder_shots(db_path, ids)

    # 复制帧数据（v0.8.4：统一 frames 模型——复制保留全部帧与帧文件，
    # 不再只拍一张 legacy 图；源镜头无帧行时兜底拍 f0）
    from core.db import get_frames, add_frame, update_shot
    src_shot = next((s for s in get_all_shots(db_path) if s["scene_name"] == scene_name), None)
    src_frames = get_frames(db_path, src_shot["id"]) if src_shot else []
    cover_thumb = None
    cover_still = None
    if src_frames:
        for f in src_frames:
            src_file = f.get("image_path")
            dst_file = None
            if src_file and os.path.exists(src_file):
                dst_file = os.path.join(shot_dir, os.path.basename(src_file))
                try:
                    if os.path.normpath(src_file) != os.path.normpath(dst_file):
                        _shutil.copy2(src_file, dst_file)
                except Exception as e:
                    print(f"[Storyboard] Duplicate frame copy failed: {e}")
                    dst_file = None
            add_frame(db_path, shot_id, f["frame_no"],
                      image_path=dst_file, is_cover=bool(f["is_cover"]))
            if f.get("is_cover"):
                cover_thumb = dst_file
                # 封面帧的全尺寸存档：新格式 fNNNNN_still.jpg / still.jpg，老数据 _still.png / still.png 兜底（v0.9.4）
                still_candidates = []
                if src_file:
                    b = os.path.basename(src_file)
                    if b in ("thumb.jpg", "still.jpg", "still.png"):
                        still_candidates = ["still.jpg", "still.png"]
                    elif b.endswith("_thumb.jpg"):
                        stem = b[:-len("_thumb.jpg")]
                        still_candidates = [stem + "_still.jpg", stem + "_still.png"]
                for still_name in still_candidates:
                    src_still = os.path.join(os.path.dirname(src_file), still_name)
                    dst_still = os.path.join(shot_dir, still_name)
                    if os.path.exists(src_still):
                        try:
                            if os.path.normpath(src_still) != os.path.normpath(dst_still):
                                _shutil.copy2(src_still, dst_still)
                            cover_still = dst_still
                        except Exception as e:
                            print(f"[Storyboard] Duplicate still copy failed: {e}")
                        break
        if cover_thumb:
            update_shot(db_path, shot_id,
                        still_path=cover_still or "",
                        thumb_path=cover_thumb,
                        thumb_fresh=True)
    elif new_scene.camera and project_dir:
        # 无帧行（理论不发生，v0.7.0 迁移保证所有镜头有帧）：兜底拍 f0
        try:
            cmd_render_frame({
                "scene_name": new_scene.name,
                "shot_id": shot_id,
                "project_dir": project_dir,
                "frame_no": 0,
            })
        except Exception as e:
            print(f"[Storyboard] Auto-render after duplicate failed: {e}")

    return {"new_scene": new_scene.name, "shot_id": shot_id}


def cmd_delete_shot(params):
    """Delete a shot's scene + shot directory. Safe: switches away first if active."""
    scene_name = params.get("scene_name")
    shot_name = params.get("shot_name")
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")

    scene = bpy.data.scenes.get(scene_name)
    if scene:
        # If deleting the active scene, switch to another first
        try:
            if bpy.context.window and bpy.context.window.scene == scene:
                fallback = next((s for s in bpy.data.scenes if s != scene), None)
                if fallback:
                    bpy.context.window.scene = fallback
        except Exception:
            pass  # No window context (timer/headless) - proceed anyway
        # 重场景 + 全局撤销：scenes.remove() 会给整个 .blend 写一份撤销快照，
        # 大文件下能卡死几分钟。batch_remove + 临时关全局撤销是瞬删。
        prefs = bpy.context.preferences.edit
        undo_was = prefs.use_global_undo
        prefs.use_global_undo = False
        try:
            bpy.data.batch_remove(ids=(scene,))
        finally:
            prefs.use_global_undo = undo_was

    # Clean up shot directory (new + legacy formats)
    if project_dir and shot_id:
        from core.paths import remove_shot_dirs
        remove_shot_dirs(project_dir, shot_name, shot_id)

    return {"deleted": scene_name}


def cmd_trash_shot(params):
    """Soft delete: park the scene under a __trash__ prefix (files stay on disk).
    The DB side (deleted=1 + scene_name) is handled by the caller."""
    scene_name = params.get("scene_name")
    trash_name = params.get("trash_scene_name")
    scene = bpy.data.scenes.get(scene_name)
    if scene:
        scene.name = trash_name
    return {"trashed": trash_name}


def cmd_restore_shot(params):
    """Restore from trash: scene name back to Shot_<name>. Refuses on conflict."""
    trash_name = params.get("trash_scene_name")
    scene_name = params.get("scene_name")
    if scene_name in bpy.data.scenes:
        raise ValueError(f"Scene {scene_name} already exists")
    scene = bpy.data.scenes.get(trash_name)
    if scene:
        scene.name = scene_name
    return {"restored": scene_name}


def cmd_rename_shot(params):
    """Rename a shot across four layers: DB name, scene, camera, shot directory.

    Refuses on any naming conflict (caller checks name_exists first, this is
    the second line of defense for scene-name collisions).
    """
    import os, shutil
    from core.db import get_db_path, update_shot, get_shot

    shot_id = params.get("shot_id")
    old_name = params.get("old_name")
    new_name = params.get("new_name")
    project_dir = params.get("project_dir")
    if not (shot_id and new_name and project_dir):
        raise ValueError("shot_id, new_name, project_dir required")

    new_scene_name = f"Shot_{new_name}"
    new_cam_name = f"Cam_{new_name}"

    if new_scene_name in bpy.data.scenes:
        raise ValueError(f"Scene {new_scene_name} already exists")

    db_path = get_db_path(project_dir)
    shot = get_shot(db_path, shot_id)
    if not shot:
        raise ValueError(f"Shot not found: {shot_id}")
    if not old_name:
        old_name = shot["name"]

    # 1) Scene rename
    scene = bpy.data.scenes.get(shot["scene_name"])
    if scene:
        scene.name = new_scene_name

    # 2) Camera rename (object + data)
    cam_name = ""
    target_scene = bpy.data.scenes.get(new_scene_name)
    if target_scene and target_scene.camera:
        cam_obj = target_scene.camera
        cam_obj.name = new_cam_name
        if cam_obj.data:
            cam_obj.data.name = new_cam_name
        cam_name = cam_obj.name

    # 3) Directory rename ({old}_{id} or legacy {id} -> {new}_{id})
    new_dir_rel = f"{new_name}_{shot_id}"
    shots_root = os.path.join(project_dir, "shots")
    moved_old = moved_new = None
    for cand in (f"{old_name}_{shot_id}", shot_id):
        old_dir = os.path.join(shots_root, cand)
        if os.path.exists(old_dir) and cand != new_dir_rel:
            new_dir = os.path.join(shots_root, new_dir_rel)
            if not os.path.exists(new_dir):
                os.rename(old_dir, new_dir)
                moved_old, moved_new = old_dir, new_dir
            break

    # 3.5) Camera background images pointing into the old directory must be
    # repointed — otherwise their absolute paths dangle and the picture is
    # lost on next file load (v0.6.1 bugfix: rename kills image-shot bgs)
    if moved_new and target_scene and target_scene.camera and target_scene.camera.data:
        old_norm = os.path.normpath(moved_old)
        for bg in target_scene.camera.data.background_images:
            img = bg.image
            if not img or not img.filepath:
                continue
            try:
                abs_p = os.path.normpath(bpy.path.abspath(img.filepath))
            except Exception:
                continue
            if os.path.dirname(abs_p) == old_norm:
                new_p = os.path.join(moved_new, os.path.basename(abs_p))
                if os.path.exists(new_p):
                    img.filepath = new_p
                    try:
                        img.reload()
                    except Exception:
                        pass

    # 4) DB update (paths follow the new directory)
    still_path = os.path.join(shots_root, new_dir_rel, "still.png")
    thumb_path = os.path.join(shots_root, new_dir_rel, "thumb.jpg")
    update_shot(db_path, shot_id,
                name=new_name,
                scene_name=new_scene_name,
                camera=cam_name or shot["camera"],
                still_path=still_path if os.path.exists(still_path) else "",
                thumb_path=thumb_path if os.path.exists(thumb_path) else "")

    # 4.5) frames 行的 image_path 重指向新目录（v0.9.19 修复：改名后 frames 表
    # 仍指向旧目录绝对路径 → 前端 imageUrl 全丢（红格子），多图镜头改名丢图。
    # update_frame 重指会顺带 bump 帧 ver → 前端恰好刷新该帧图。undo 改名反打
    # 时目录改回旧名、路径再次匹配，无需逆更新。）
    if moved_new:
        from core.db import get_frames, update_frame
        for fr in get_frames(db_path, shot_id):
            ip = fr.get("image_path")
            if ip:
                new_ip = os.path.join(moved_new, os.path.basename(ip))
                if os.path.exists(new_ip):   # 文件确实随目录搬到新位置（目录已改名，别查旧路径）
                    update_frame(db_path, fr["id"], image_path=new_ip)

    return {"renamed": f"{old_name} -> {new_name}", "scene": new_scene_name}


def cmd_set_project_resolution(params):
    """画幅比/分辨率设置（v0.9.7）：主线程遍历所有 scene 改渲染分辨率。
    决策 B：宽高直改（resolution_x/y = 输入值），画幅比 = w/h。
    垃圾桶场景（__trash__ 前缀）也一起改——恢复时分辨率应跟随项目当前设置。"""
    w = int(params.get("width"))
    h = int(params.get("height"))
    changed = 0
    for s in bpy.data.scenes:
        s.render.resolution_x = w
        s.render.resolution_y = h
        changed += 1
    return {"scenes_updated": changed, "resolution": f"{w}x{h}"}


def cmd_create_shot_scene(params):
    """Create Blender scene for a shot (called from web API).
    Auto-renders when shot_id+project_dir are provided."""
    from core.scenes import create_shot_scene

    shot_name = params.get("shot_name")
    scene_name = params.get("scene_name")

    new_scene = create_shot_scene(shot_name, scene_name)
    if not new_scene:
        return {"error": f"Scene {scene_name} already exists"}

    # 设置场景时长（帧范围）
    duration = params.get("duration", 2.0)
    fps = new_scene.render.fps
    new_scene.frame_start = 1
    new_scene.frame_end = max(1, int(duration * fps))

    # Auto-render as frame 0 (create-path auto 拍屏, v0.8.4: 统一 frames 模型)
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")
    if shot_id and project_dir:
        try:
            cmd_render_frame({
                "scene_name": new_scene.name,
                "shot_id": shot_id,
                "project_dir": project_dir,
                "frame_no": 0,
            })
        except Exception as e:
            print(f"[Storyboard] Auto-render after create failed: {e}")

    return {"scene": scene_name, "camera": new_scene.camera.name}


def cmd_create_image_shot_scene(params):
    """Create a shot scene from an external image: the image becomes the
    camera's background image, then auto-render produces still+thumb."""
    from core.scenes import create_shot_scene

    shot_name = params.get("shot_name")
    scene_name = params.get("scene_name")
    image_path = params.get("image_path")
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")

    new_scene = create_shot_scene(shot_name, scene_name, image_path=image_path)
    if not new_scene:
        return {"error": f"Scene {scene_name} already exists"}

    if shot_id and project_dir:
        try:
            cmd_render_frame({
                "scene_name": new_scene.name,
                "shot_id": shot_id,
                "project_dir": project_dir,
                "frame_no": 0,
            })
        except Exception as e:
            print(f"[Storyboard] Auto-render after image-create failed: {e}")

    return {"scene": scene_name, "camera": new_scene.camera.name,
            "background": bool(image_path)}


def cmd_reorder(params):
    """Reorder shots (placeholder for VSE sync in Phase 3)."""
    shot_ids = params.get("shot_ids", [])
    return {"reordered": len(shot_ids)}


def cmd_set_camera_background(params):
    """Set an external image as the shot camera's background (100% opacity),
    then auto-render so the thumbnail reflects it immediately."""
    scene_name = params.get("scene_name")
    image_path = params.get("image_path")
    shot_id = params.get("shot_id")
    shot_name = params.get("shot_name")
    project_dir = params.get("project_dir")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")
    if not scene.camera:
        raise ValueError("No camera in scene")

    import os
    if not image_path or not os.path.exists(image_path):
        raise ValueError(f"Image not found: {image_path}")

    cam_data = scene.camera.data
    img = bpy.data.images.load(image_path, check_existing=True)
    if len(cam_data.background_images):
        bg = cam_data.background_images[0]
        bg.image = img
    else:
        bg = cam_data.background_images.new()
        bg.image = img
    bg.alpha = 1.0  # 100% opaque, always
    cam_data.show_background_images = True

    if shot_id and project_dir:
        # v0.8.4：拖图换背景 = 重拍封面帧（显示的图）；无帧行兜底 f0
        try:
            from core.db import get_db_path
            db_path = get_db_path(project_dir)
            cmd_render_frame({
                "scene_name": scene.name,
                "shot_id": shot_id,
                "project_dir": project_dir,
                "frame_no": _cover_frame_no(db_path, shot_id),
            })
        except Exception as e:
            print(f"[Storyboard] Re-render after set-background failed: {e}")

    return {"scene": scene_name, "background": os.path.basename(image_path)}


def cmd_sync_scenes(params):
    """Sync Blender scenes with DB. Blender file is authority.
    Single implementation lives in core.sync (shared with the panel operator).
    v0.9.25: 完整版返回 7 元组（末位 registered = 新登记其它场景数）。"""
    from core.sync import sync_scenes_with_db

    removed, orphans, deduped, dirs_removed, dirs_migrated, frames_removed, registered = sync_scenes_with_db()
    return {"removed": removed, "orphans": len(orphans), "deduped": deduped,
            "dirs_removed": dirs_removed, "dirs_migrated": dirs_migrated,
            "frames_removed": frames_removed, "registered": registered}


def cmd_adopt_other_scene(params):
    """把「其它」场景转为正式镜头（决策 A1：统一 c 编号；D1：无相机自动补默认相机）。

    流程：场景改名 Shot_cXXXX + 相机改名 Cam_cXXXX（无相机则补默认）
    → DB 记录转 origin='storyboard'（name/scene_name/camera 联动）
    → 建镜头目录 → 自动拍封面帧。undo 逆操作 = rename_scene 改回原名 + DB 还原。"""
    import os
    from core.db import get_db_path, update_shot, next_c_number

    scene_name = params.get("scene_name")
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")
    if not (scene_name and shot_id and project_dir):
        raise ValueError("scene_name, shot_id, project_dir required")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")

    # 编号分配：调用方指定（next_c_name 算过 DB 空闲）；场景层撞名（正名幽灵/
    # 手动建 Shot_cXXXX）自动 +10 重试——next_c_number 只认 name 全匹配 c 编号，
    # 幽灵场景 name='Shot_cXXXX' 不在编号池里，必须场景层兜底
    db_path = get_db_path(project_dir)
    new_name = params.get("new_name") or ""
    if not new_name or f"Shot_{new_name}" in bpy.data.scenes:
        n = next_c_number(db_path)
        while f"Shot_c{n:04d}" in bpy.data.scenes:
            n += 10
        new_name = f"c{n:04d}"

    new_scene_name = f"Shot_{new_name}"
    new_cam_name = f"Cam_{new_name}"

    # 1) 场景改名
    scene.name = new_scene_name

    # 2) 相机：有则改名，无则补默认（D1——手动场景常无相机，补了才能自动拍封面）
    cam_obj = scene.camera
    if cam_obj:
        cam_obj.name = new_cam_name
        if cam_obj.data:
            cam_obj.data.name = new_cam_name
    else:
        from core.scenes import DEFAULT_CAM_LOCATION, DEFAULT_CAM_ROTATION
        cam_data = bpy.data.cameras.new(name=new_cam_name)
        cam_obj = bpy.data.objects.new(name=new_cam_name, object_data=cam_data)
        scene.collection.objects.link(cam_obj)
        scene.camera = cam_obj
        cam_obj.location = DEFAULT_CAM_LOCATION
        cam_obj.rotation_euler = DEFAULT_CAM_ROTATION

    # 场景时长（同创建路径）
    duration = params.get("duration", 2.0)
    scene.frame_start = 1
    scene.frame_end = max(1, int(duration * scene.render.fps))

    # 3) DB：现有 other 记录转 storyboard（四层联动同 rename 语义）
    update_shot(db_path, shot_id,
                name=new_name,
                scene_name=new_scene_name,
                camera=new_cam_name,
                origin="storyboard")

    # 4) 建镜头目录 + 自动拍封面帧（cmd_render_frame 按 shot_id 找记录 ✓）
    shot_dir = os.path.join(project_dir, "shots", f"{new_name}_{shot_id}")
    os.makedirs(shot_dir, exist_ok=True)
    try:
        cmd_render_frame({
            "scene_name": new_scene_name,
            "shot_id": shot_id,
            "project_dir": project_dir,
            "frame_no": 0,
        })
    except Exception as e:
        print(f"[Storyboard] Auto-render after adopt failed: {e}")

    return {"new_name": new_name, "new_scene": new_scene_name, "shot_id": shot_id}


def cmd_delete_other_scene(params):
    """硬删「其它」场景（决策 B1：直接删，不进垃圾桶；不可撤销）。
    复用 cmd_delete_shot 的切走激活场景 + 关全局撤销瞬删保护；
    最后场景保护：Blender 不允许删光场景，只剩一个时拒绝。"""
    scene_name = params.get("scene_name")
    if not scene_name:
        raise ValueError("scene_name required")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        return {"deleted": scene_name, "note": "scene already gone"}

    if len(bpy.data.scenes) <= 1:
        raise ValueError("Cannot delete the last scene")

    # 删激活场景必须先切走（同 cmd_delete_shot 保护）
    try:
        if bpy.context.window and bpy.context.window.scene == scene:
            fallback = next((s for s in bpy.data.scenes if s != scene), None)
            if fallback:
                bpy.context.window.scene = fallback
    except Exception:
        pass  # No window context (timer/headless) - proceed anyway

    # 重场景 + 全局撤销：batch_remove + 临时关全局撤销 = 瞬删（同 cmd_delete_shot）
    prefs = bpy.context.preferences.edit
    undo_was = prefs.use_global_undo
    prefs.use_global_undo = False
    try:
        bpy.data.batch_remove(ids=(scene,))
    finally:
        prefs.use_global_undo = undo_was

    return {"deleted": scene_name}


def cmd_rename_scene(params):
    """纯场景改名（adopt 的 undo 逆操作用：镜头场景改回原名）。不碰 DB。"""
    scene_name = params.get("scene_name")
    new_name = params.get("new_name")
    if not (scene_name and new_name):
        raise ValueError("scene_name, new_name required")
    if new_name in bpy.data.scenes:
        raise ValueError(f"Scene {new_name} already exists")
    scene = bpy.data.scenes.get(scene_name)
    if scene:
        scene.name = new_name
    return {"renamed": f"{scene_name} -> {new_name}"}


def queue_idle():
    """队列空闲？（sync 心跳用：有命令排队时跳过对账，防创建竞态）"""
    return _command_queue.empty()


# Command registry: name -> (handler, [required params]).
# execute_command validates required params before dispatch, so handlers can
# assume their inputs exist (params.get still guards optionals).
# ---------- multi-frame commands (v0.7.0) ----------

def cmd_render_frame(params):
    """Render one frame of a multi-frame shot: jump timeline to frame_no,
    OpenGL 拍屏, write fNNNNN_still.png / fNNNNN_thumb.jpg, upsert the
    frames row, and refresh shots.thumb_* if this frame is (or becomes) the
    cover. Creates the frames row if it doesn't exist yet (add-frame flow);
    overwrites the existing row's image_path on re-render."""
    import os
    from core.db import (get_db_path, get_all_shots, get_frames, add_frame,
                         update_frame, update_shot)
    from core.render import render_shot_files

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
    from core.db import (get_db_path, get_frames, set_cover_frame, update_shot)

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


def cmd_jump_to_frame(params):
    """Switch to the shot's scene and set the timeline to frame_no
    (跳回构图). The user lands exactly where that frame was captured."""
    shot_scene = params.get("scene_name")
    frame_no = int(params.get("frame_no"))

    scene = bpy.data.scenes.get(shot_scene)
    if not scene:
        raise ValueError(f"Scene not found: {shot_scene}")

    bpy.context.window.scene = scene
    scene.frame_set(frame_no)

    # Camera view in all 3D viewports
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.region_3d.view_perspective = 'CAMERA'

    return {"scene": shot_scene, "frame": frame_no}


def cmd_delete_frame(params):
    """Delete one frame: DB row + disk files. If the deleted frame was the
    cover, promote the lowest-frame_no sibling to cover and sync thumb."""
    import os
    from core.db import (get_db_path, get_frames, delete_frame,
                         set_cover_frame, update_shot)

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
    if target["image_path"]:
        base = target["image_path"]
        for p in {base, base.replace("_thumb.jpg", "_still.png")}:
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


COMMANDS = {
    "open_shot": (cmd_open_shot, ["scene_name"]),
    "duplicate_shot": (cmd_duplicate_shot, ["scene_name", "project_dir"]),
    "delete_shot": (cmd_delete_shot, ["scene_name"]),
    "trash_shot": (cmd_trash_shot, ["scene_name", "trash_scene_name"]),
    "restore_shot": (cmd_restore_shot, ["trash_scene_name", "scene_name"]),
    "rename_shot": (cmd_rename_shot, ["shot_id", "new_name", "project_dir"]),
    "reorder": (cmd_reorder, []),
    "create_shot_scene": (cmd_create_shot_scene, ["shot_name", "scene_name"]),
    "create_image_shot_scene": (cmd_create_image_shot_scene, ["shot_name", "scene_name"]),
    "set_camera_background": (cmd_set_camera_background, ["scene_name", "image_path"]),
    "sync_scenes": (cmd_sync_scenes, []),
    "adopt_other_scene": (cmd_adopt_other_scene, ["scene_name", "shot_id", "project_dir"]),
    "delete_other_scene": (cmd_delete_other_scene, ["scene_name"]),
    "rename_scene": (cmd_rename_scene, ["scene_name", "new_name"]),
    "render_frame": (cmd_render_frame, ["scene_name", "shot_id", "project_dir", "frame_no"]),
    "set_cover_frame": (cmd_set_cover_frame, ["shot_id", "frame_id", "project_dir"]),
    "set_project_resolution": (cmd_set_project_resolution, ["width", "height"]),
    "jump_to_frame": (cmd_jump_to_frame, ["scene_name", "frame_no"]),
    "delete_frame": (cmd_delete_frame, ["shot_id", "frame_id", "project_dir"]),
}
