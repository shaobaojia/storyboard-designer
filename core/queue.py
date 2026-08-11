"""
Remote command queue for Storyboard Designer.
bpy operations must run in Blender's main thread.
HTTP requests arrive in background thread → queue → main thread timer consumes.

v0.9.73 拆分：命令实现搬至 core.commands_shots（镜头域）/ core.commands_frames
（帧域），本模块保留队列机制 + COMMANDS 注册表 + 公开符号 re-export
（__init__.py / core.actions.py 的 import 路径不变，零调用方改动）。
"""
import bpy
import queue
import threading
from collections import deque

# v0.9.73 拆分：命令实现分域（依赖方向单向无环：queue → commands → core 叶子）
from core.commands_frames import (cmd_render_frame, cmd_set_cover_frame,
                                  cmd_delete_frame)
from core.commands_shots import (cmd_open_shot, cmd_duplicate_shot,
                                 cmd_delete_shot, cmd_trash_shot,
                                 cmd_restore_shot, cmd_rename_shot,
                                 cmd_list_scene_names, cmd_reorder,
                                 cmd_create_shot_scene,
                                 cmd_create_image_shot_scene,
                                 cmd_set_camera_background, cmd_sync_scenes,
                                 cmd_adopt_other_scene, cmd_delete_other_scene,
                                 cmd_rename_scene, cmd_set_project_resolution,
                                 cmd_jump_to_frame, _cover_frame_no)

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


def redraw_view3d():
    """Refresh all VIEW_3D areas (side panel redraw).

    v0.9.34：改 DB 的命令/operator 执行后必须调用——Blender 面板不会自动重绘，
    不加则帧按钮等面板内容要鼠标悬停（触发 region 重绘）才刷新。
    主线程安全（tag_redraw 是线程安全的请求标记）。
    先失效面板 DB 读缓存（1s TTL），否则重绘读到的还是旧数据。"""
    try:
        panel_db_cache["ts"] = 0.0
    except Exception:
        pass
    try:
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                area.tag_redraw()
    except Exception:
        pass


# 面板 DB 读取缓存（v0.8.0）：draw 频率极高，DB 可能在 SMB 盘上，1s TTL 足够跟手。
# v0.9.34 移到 queue.py：redraw_view3d 需要先失效它再重绘，跨模块共享（__init__.py import 使用）
panel_db_cache = {"ts": 0.0, "key": None, "shot": None, "frames": []}


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
            # v0.9.34：命令改 DB 后刷新面板（否则帧按钮等要鼠标悬停才刷新）
            redraw_view3d()
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


def queue_idle():
    """队列空闲？（sync 心跳用：有命令排队时跳过对账，防创建竞态）"""
    return _command_queue.empty()


# Command registry: name -> (handler, [required params]).
# execute_command validates required params before dispatch, so handlers can
# assume their inputs exist (params.get still guards optionals).
# v0.9.73：handler 实现已拆分至 core.commands_shots / core.commands_frames。
# ---------- multi-frame commands (v0.7.0) ----------

COMMANDS = {
    "open_shot": (cmd_open_shot, ["scene_name"]),
    "duplicate_shot": (cmd_duplicate_shot, ["scene_name", "project_dir"]),
    "delete_shot": (cmd_delete_shot, ["scene_name"]),
    "trash_shot": (cmd_trash_shot, ["scene_name", "trash_scene_name"]),
    "restore_shot": (cmd_restore_shot, ["trash_scene_name", "scene_name"]),
    "rename_shot": (cmd_rename_shot, ["shot_id", "new_name", "project_dir"]),
    "list_scene_names": (cmd_list_scene_names, []),
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
