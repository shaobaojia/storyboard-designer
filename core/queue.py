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
    missing = [k for k in required if not params.get(k)]
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


def _render_and_update(scene, shot_id, shot_name, project_dir):
    """Render still+thumb for a scene and update DB. Shared by rerender & auto-render."""
    import os
    from core.db import get_db_path, update_shot
    from core.render import render_shot_files

    prev = _switch_scene(scene)
    shot_dir = os.path.join(project_dir, "shots", f"{shot_name}_{shot_id}")
    try:
        paths = render_shot_files(scene, shot_dir)
    finally:
        _restore_scene(prev)

    update_shot(get_db_path(project_dir), shot_id,
                still_path=paths["still_path"],
                thumb_path=paths["thumb_path"])
    return paths


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
            for region in area.regions:
                if region.type == 'WINDOW':
                    with bpy.context.temp_override(area=area, region=region):
                        bpy.ops.view3d.view_camera()

    return {"scene": scene_name, "camera": scene.camera.name if scene.camera else None}


def cmd_rerender_shot(params):
    """Re-render a shot (still + thumb) via viewport OpenGL (拍屏).

    Switches the active scene to the target first so the viewport shows the
    correct scene — opengl renders whatever the viewport is looking at.
    """
    scene_name = params.get("scene_name")
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")
    if not scene.camera:
        raise ValueError("No camera in scene")

    import os
    from core.db import get_db_path, get_all_shots

    # Find shot name for directory naming
    db_path = get_db_path(project_dir)
    shots = get_all_shots(db_path)
    shot = next((s for s in shots if s["id"] == shot_id), None)
    shot_name = shot["name"] if shot else shot_id

    paths = _render_and_update(scene, shot_id, shot_name, project_dir)
    return {"still": paths["still_path"], "thumb": paths["thumb_path"]}


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

    # Create DB record
    import os
    from core.db import get_db_path, create_shot

    db_path = get_db_path(project_dir)
    shot_id = create_shot(db_path, new_name, new_scene.name,
                          camera=new_scene.camera.name if new_scene.camera else "",
                          duration=2.0)

    shot_dir = os.path.join(project_dir, "shots", f"{new_name}_{shot_id}")
    os.makedirs(shot_dir, exist_ok=True)

    # Auto-render the new shot (failure must not fail the duplicate)
    try:
        if new_scene.camera and project_dir:
            _render_and_update(new_scene, shot_id, new_name, project_dir)
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
        bpy.data.scenes.remove(scene, do_unlink=True)

    # Clean up shot directory (new + legacy formats)
    if project_dir and shot_id:
        from core.paths import remove_shot_dirs
        remove_shot_dirs(project_dir, shot_name, shot_id)

    return {"deleted": scene_name}


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
    for cand in (f"{old_name}_{shot_id}", shot_id):
        old_dir = os.path.join(shots_root, cand)
        if os.path.exists(old_dir) and cand != new_dir_rel:
            new_dir = os.path.join(shots_root, new_dir_rel)
            if not os.path.exists(new_dir):
                os.rename(old_dir, new_dir)
            break

    # 4) DB update (paths follow the new directory)
    still_path = os.path.join(shots_root, new_dir_rel, "still.png")
    thumb_path = os.path.join(shots_root, new_dir_rel, "thumb.jpg")
    update_shot(db_path, shot_id,
                name=new_name,
                scene_name=new_scene_name,
                camera=cam_name or shot["camera"],
                still_path=still_path if os.path.exists(still_path) else "",
                thumb_path=thumb_path if os.path.exists(thumb_path) else "")

    return {"renamed": f"{old_name} -> {new_name}", "scene": new_scene_name}


def cmd_create_shot_scene(params):
    """Create Blender scene for a shot (called from web API).
    Auto-renders when shot_id+project_dir are provided."""
    from core.scenes import create_shot_scene

    shot_name = params.get("shot_name")
    scene_name = params.get("scene_name")

    new_scene = create_shot_scene(shot_name, scene_name)
    if not new_scene:
        return {"error": f"Scene {scene_name} already exists"}

    # Auto-render (item: create-path auto 拍屏) — failure must not fail creation
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")
    if shot_id and project_dir:
        try:
            _render_and_update(new_scene, shot_id, shot_name, project_dir)
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
            _render_and_update(new_scene, shot_id, shot_name, project_dir)
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
        if not shot_name:
            shot_name = scene_name
        _render_and_update(scene, shot_id, shot_name, project_dir)

    return {"scene": scene_name, "background": os.path.basename(image_path)}


def cmd_sync_scenes(params):
    """Sync Blender scenes with DB. Blender file is authority.
    Single implementation lives in core.sync (shared with the panel operator)."""
    from core.sync import sync_scenes_with_db

    removed, orphans, deduped, dirs_removed, dirs_migrated = sync_scenes_with_db()
    return {"removed": removed, "orphans": len(orphans), "deduped": deduped,
            "dirs_removed": dirs_removed, "dirs_migrated": dirs_migrated}


# Command registry: name -> (handler, [required params]).
# execute_command validates required params before dispatch, so handlers can
# assume their inputs exist (params.get still guards optionals).
COMMANDS = {
    "open_shot": (cmd_open_shot, ["scene_name"]),
    "rerender_shot": (cmd_rerender_shot, ["scene_name", "shot_id", "project_dir"]),
    "duplicate_shot": (cmd_duplicate_shot, ["scene_name", "project_dir"]),
    "delete_shot": (cmd_delete_shot, ["scene_name"]),
    "rename_shot": (cmd_rename_shot, ["shot_id", "new_name", "project_dir"]),
    "reorder": (cmd_reorder, []),
    "create_shot_scene": (cmd_create_shot_scene, ["shot_name", "scene_name"]),
    "create_image_shot_scene": (cmd_create_image_shot_scene, ["shot_name", "scene_name"]),
    "set_camera_background": (cmd_set_camera_background, ["scene_name", "image_path"]),
    "sync_scenes": (cmd_sync_scenes, []),
}
