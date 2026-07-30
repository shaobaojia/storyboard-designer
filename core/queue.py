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
    """Queue a command for main thread execution."""
    _command_queue.put({
        "command": command,
        "params": params,
        "callback": callback,
        "result": None,
        "error": None,
        "done": threading.Event(),
    })
    ensure_timer()


def ensure_timer():
    """Ensure the main thread timer is registered."""
    global _timer_registered
    if not _timer_registered:
        try:
            bpy.app.timers.register(process_queue, first_interval=0.1, persistent=True)
            _timer_registered = True
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
    from core.db import get_db_path, update_shot

    shot_dir = os.path.join(project_dir, "shots", shot_id)
    os.makedirs(shot_dir, exist_ok=True)

    # Render still - use standard render (works in any thread)
    still_path = os.path.join(shot_dir, "still.png")
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = still_path
    scene.render.engine = 'BLENDER_WORKBENCH'  # Fast preview render
    bpy.ops.render.render(write_still=True, scene=scene.name)

    # Generate thumbnail
    thumb_path = os.path.join(shot_dir, "thumb.jpg")
    img = bpy.data.images.load(still_path)
    w, h = img.size
    if w > 320:
        scale = 320 / w
        img.scale(320, int(h * scale))
    img.filepath_raw = thumb_path
    img.file_format = 'JPEG'
    img.save()
    bpy.data.images.remove(img)

    # Update DB
    db_path = get_db_path(project_dir)
    update_shot(db_path, shot_id, still_path=still_path, thumb_path=thumb_path)

    return {"still": still_path, "thumb": thumb_path}


def cmd_duplicate_shot(params):
    """Duplicate a shot's scene."""
    scene_name = params.get("scene_name")
    new_name = params.get("new_name")
    project_dir = params.get("project_dir")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")

    # Duplicate scene
    new_scene = scene.copy()
    new_scene.name = f"{scene_name}_copy"

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

    shot_dir = os.path.join(project_dir, "shots", shot_id)
    os.makedirs(shot_dir, exist_ok=True)

    return {"new_scene": new_scene.name, "shot_id": shot_id}


def cmd_delete_shot(params):
    """Delete a shot's scene."""
    scene_name = params.get("scene_name")

    scene = bpy.data.scenes.get(scene_name)
    if not scene:
        raise ValueError(f"Scene not found: {scene_name}")

    bpy.data.scenes.remove(scene)
    return {"deleted": scene_name}


def cmd_reorder(params):
    """Reorder shots (placeholder for VSE sync in Phase 3)."""
    shot_ids = params.get("shot_ids", [])
    return {"reordered": len(shot_ids)}
