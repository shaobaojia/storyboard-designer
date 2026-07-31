"""
Remote command queue for Storyboard Designer.
bpy operations must run in Blender's main thread.
HTTP requests arrive in background thread → queue → main thread timer consumes.
"""
import bpy
import queue
import threading

# Thread-safe queue for remote commands
_command_queue = queue.Queue()
_timer_registered = False


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
        finally:
            cmd["done"].set()
            if cmd["callback"]:
                try:
                    cmd["callback"](cmd)
                except Exception:
                    pass

    return 0.03  # 30ms interval


def execute_command(command, params):
    """Execute a remote command in main thread."""
    if command == "open_shot":
        return cmd_open_shot(params)
    elif command == "rerender_shot":
        return cmd_rerender_shot(params)
    elif command == "duplicate_shot":
        return cmd_duplicate_shot(params)
    elif command == "delete_shot":
        return cmd_delete_shot(params)
    elif command == "reorder":
        return cmd_reorder(params)
    elif command == "create_shot_scene":
        return cmd_create_shot_scene(params)
    elif command == "sync_scenes":
        return cmd_sync_scenes(params)
    else:
        raise ValueError(f"Unknown command: {command}")


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
    """Re-render a shot (still + thumb)."""
    scene_name = params.get("scene_name")
    shot_id = params.get("shot_id")
    project_dir = params.get("project_dir")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")

    if not scene.camera:
        raise ValueError("No camera in scene")

    import os
    from core.db import get_db_path, update_shot, get_all_shots
    from core.render import render_shot_files

    # Find shot name for directory naming
    db_path = get_db_path(project_dir)
    shots = get_all_shots(db_path)
    shot = next((s for s in shots if s["id"] == shot_id), None)
    shot_name = shot["name"] if shot else shot_id

    shot_dir = os.path.join(project_dir, "shots", f"{shot_name}_{shot_id}")
    paths = render_shot_files(scene, shot_dir)

    update_shot(db_path, shot_id,
                still_path=paths["still_path"],
                thumb_path=paths["thumb_path"])
    return {"still": paths["still_path"], "thumb": paths["thumb_path"]}


def cmd_duplicate_shot(params):
    """Duplicate a shot's scene."""
    scene_name = params.get("scene_name")
    new_name = params.get("new_name")
    project_dir = params.get("project_dir")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")

    # Duplicate scene - use Shot_{new_name} convention
    new_scene = scene.copy()
    new_scene.name = f"Shot_{new_name}" if new_name else f"{scene_name}_copy"

    # Duplicate camera
    if scene.camera:
        new_cam = scene.camera.copy()
        new_cam.data = scene.camera.data.copy()
        new_scene.collection.objects.link(new_cam)
        new_scene.camera = new_cam

    # Create DB record
    import os
    from core.db import get_db_path, create_shot

    db_path = get_db_path(project_dir)
    shot_id = create_shot(db_path, new_name, new_scene.name,
                          camera=new_scene.camera.name if new_scene.camera else "",
                          duration=2.0, shot_type="3d")

    shot_dir = os.path.join(project_dir, "shots", f"{new_name}_{shot_id}")
    os.makedirs(shot_dir, exist_ok=True)

    return {"new_scene": new_scene.name, "shot_id": shot_id}


def cmd_delete_shot(params):
    """Delete a shot's scene. Safe: switches away first if it's the active scene."""
    scene_name = params.get("scene_name")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        return {"deleted": None, "reason": "already gone"}

    # If deleting the active scene, switch to another first
    try:
        if bpy.context.window and bpy.context.window.scene == scene:
            fallback = next((s for s in bpy.data.scenes if s != scene), None)
            if fallback:
                bpy.context.window.scene = fallback
    except Exception:
        pass  # No window context (timer/headless) - proceed anyway

    bpy.data.scenes.remove(scene, do_unlink=True)
    return {"deleted": scene_name}


def cmd_create_shot_scene(params):
    """Create Blender scene for a shot (called from web API)."""
    shot_name = params.get("shot_name")
    scene_name = params.get("scene_name")
    duration = params.get("duration", 2.0)
    shot_type = params.get("shot_type", "3d")

    # Create scene
    if scene_name in bpy.data.scenes:
        return {"error": f"Scene {scene_name} already exists"}

    new_scene = bpy.data.scenes.new(name=scene_name)

    # Create camera
    cam_data = bpy.data.cameras.new(name=f"Cam_{shot_name}")
    cam_obj = bpy.data.objects.new(name=f"Cam_{shot_name}", object_data=cam_data)
    new_scene.collection.objects.link(cam_obj)
    new_scene.camera = cam_obj
    cam_obj.location = (7, -7, 5)
    cam_obj.rotation_euler = (1.1, 0, 0.785)

    return {"scene": scene_name, "camera": cam_obj.name}


def cmd_reorder(params):
    """Reorder shots (placeholder for VSE sync in Phase 3)."""
    shot_ids = params.get("shot_ids", [])
    return {"reordered": len(shot_ids)}


def cmd_sync_scenes(params):
    """Sync Blender scenes with DB. Blender file is authority."""
    import os
    import sys
    addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if addon_dir not in sys.path:
        sys.path.insert(0, addon_dir)

    # Import sync function from the storyboard addon module.
    # Match by module file path containing storyboard_designer, avoiding false
    # positives like bpy.ops which also expose sync_scenes operators.
    init_mod = None
    for name, mod in sys.modules.items():
        mod_file = getattr(mod, "__file__", "") or ""
        if "storyboard_designer" in mod_file and hasattr(mod, "_sync_scenes_with_db"):
            init_mod = mod
            break

    if init_mod and hasattr(init_mod, '_sync_scenes_with_db'):
        result = init_mod._sync_scenes_with_db()
        # Index-based extraction, compatible with any tuple size
        removed = result[0] if len(result) > 0 else 0
        orphans = result[1] if len(result) > 1 else []
        deduped = result[2] if len(result) > 2 else 0
        dirs_removed = result[3] if len(result) > 3 else 0
        dirs_migrated = result[4] if len(result) > 4 else 0
        return {"removed": removed, "orphans": len(orphans), "deduped": deduped,
                "dirs_removed": dirs_removed, "dirs_migrated": dirs_migrated}
    else:
        # Fallback: do it inline
        from core.db import get_db_path, delete_shot, get_all_shots

        blend_path = bpy.data.filepath
        blend_dir = os.path.dirname(blend_path)
        blend_name = os.path.splitext(os.path.basename(blend_path))[0]
        project_dir = os.path.join(blend_dir, f"{blend_name}_storyboard")

        if not os.path.exists(project_dir):
            return {"removed": 0, "orphans": 0}

        db_path = get_db_path(project_dir)
        shots = get_all_shots(db_path)
        existing_scenes = {s.name for s in bpy.data.scenes}
        removed = 0

        for shot in shots:
            if shot["scene_name"] not in existing_scenes:
                delete_shot(db_path, shot["id"])
                shot_dir = os.path.join(project_dir, "shots", shot["id"])
                if os.path.exists(shot_dir):
                    import shutil
                    shutil.rmtree(shot_dir)
                removed += 1

        return {"removed": removed, "orphans": 0}
