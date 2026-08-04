bl_info = {
    "name": "Storyboard Designer",
    "author": "Hermes",
    "version": (0, 8, 1),
    "blender": (4, 5, 0),
    "location": "View3D > Sidebar > Storyboard",
    "description": "Quick previs/storyboard design system",
    "category": "3D View",
}

import bpy
import os
import sys
import json
import threading
from bpy.props import StringProperty, FloatProperty, EnumProperty

# Add core module to path
addon_dir = os.path.dirname(os.path.abspath(__file__))
if addon_dir not in sys.path:
    sys.path.insert(0, addon_dir)

from core.db import init_db, get_db_path, create_shot, update_shot, delete_shot, get_all_shots, get_shot
from core.server import start_server, stop_server, get_server
from core.queue import queue_command, ensure_timer
from core.paths import get_project_dir as _get_project_dir
from core.sync import sync_scenes_with_db


class STORYBOARD_OT_sync_scenes(bpy.types.Operator):
    """Sync Blender scenes with storyboard database"""
    bl_idname = "storyboard.sync_scenes"
    bl_label = "Sync Scenes"
    bl_options = {'REGISTER'}

    def execute(self, context):
        removed, orphans, deduped, dirs_removed, dirs_migrated, frames_removed = sync_scenes_with_db()
        msg = f"Removed {removed} orphan records"
        if deduped:
            msg += f", deduped {deduped} duplicates"
        if dirs_removed:
            msg += f", cleaned {dirs_removed} orphan dirs"
        if dirs_migrated:
            msg += f", migrated {dirs_migrated} legacy dirs"
        if frames_removed:
            msg += f", cleaned {frames_removed} orphan frames"
        if orphans:
            msg += f", found {len(orphans)} unmanaged scenes"
        self.report({'INFO'}, msg)
        return {'FINISHED'}


class STORYBOARD_OT_init_project(bpy.types.Operator):
    """Initialize storyboard project in current blend file directory"""
    bl_idname = "storyboard.init_project"
    bl_label = "Init Project"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        os.makedirs(project_dir, exist_ok=True)
        db_path = init_db(os.path.join(project_dir, "shots.db"))

        # Create project.json if not exists
        project_json = os.path.join(project_dir, "project.json")
        if not os.path.exists(project_json):
            with open(project_json, "w") as f:
                json.dump({
                    "name": os.path.splitext(os.path.basename(bpy.data.filepath))[0],
                    "fps": context.scene.render.fps,
                    "resolution_x": context.scene.render.resolution_x,
                    "resolution_y": context.scene.render.resolution_y,
                }, f, indent=2)

        self.report({'INFO'}, f"Project initialized: {project_dir}")
        return {'FINISHED'}


class STORYBOARD_OT_start_server(bpy.types.Operator):
    """Start HTTP server for storyboard grid"""
    bl_idname = "storyboard.start_server"
    bl_label = "Start Server"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        server = start_server(project_dir, port=8089)
        # Register timer in main thread BEFORE starting server thread
        ensure_timer()
        self.report({'INFO'}, f"Server on 0.0.0.0:{server.port} (LAN accessible)")
        return {'FINISHED'}


class STORYBOARD_OT_stop_server(bpy.types.Operator):
    """Stop HTTP server"""
    bl_idname = "storyboard.stop_server"
    bl_label = "Stop Server"
    bl_options = {'REGISTER'}

    def execute(self, context):
        stop_server()
        self.report({'INFO'}, "Server stopped")
        return {'FINISHED'}


class STORYBOARD_OT_open_manager(bpy.types.Operator):
    """Open the storyboard grid page in the default browser"""
    bl_idname = "storyboard.open_manager"
    bl_label = "打开分镜管理器"
    bl_options = {'REGISTER'}

    def execute(self, context):
        import webbrowser
        server = get_server()
        if not (server and server.running):
            # 服务没起就当场拉起（正常情况下插件加载已自动起好）
            project_dir = _get_project_dir()
            if not project_dir:
                self.report({'ERROR'}, "Save blend file first")
                return {'CANCELLED'}
            server = start_server(project_dir, port=8089)
            ensure_timer()
        webbrowser.open(f"http://localhost:{server.port}")
        self.report({'INFO'}, f"Opened http://localhost:{server.port}")
        return {'FINISHED'}


# --- Shot Management ---

class STORYBOARD_OT_create_shot(bpy.types.Operator):
    """Create new shot: new Scene + camera + metadata"""
    bl_idname = "storyboard.create_shot"
    bl_label = "Create Shot"
    bl_options = {'REGISTER', 'UNDO'}

    shot_name: StringProperty(name="Shot Name", default="c0010")
    duration: FloatProperty(name="Duration", default=2.0, min=0.1)

    def execute(self, context):
        from core.scenes import create_shot_scene
        from core.paths import shot_dir as _shot_dir

        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        scene_name = f"Shot_{self.shot_name}"
        new_scene = create_shot_scene(self.shot_name, scene_name,
                                      template_scene=context.scene)
        if not new_scene:
            self.report({'ERROR'}, f"Scene {scene_name} already exists")
            return {'CANCELLED'}

        # Create DB record
        db_path = get_db_path(project_dir)
        shot_id = create_shot(db_path, self.shot_name, scene_name,
                              camera=new_scene.camera.name, duration=self.duration)

        # Create shot directory with readable name: {shot_name}_{shot_id}/
        dir_path = _shot_dir(project_dir, self.shot_name, shot_id)
        os.makedirs(dir_path, exist_ok=True)

        # Auto-render the new shot (create-path auto 拍屏); failure must not
        # fail the creation itself
        try:
            prev = context.window.scene if context.window else None
            if context.window:
                context.window.scene = new_scene
            from core.render import render_shot_files
            paths = render_shot_files(new_scene, dir_path)
            if prev and context.window:
                context.window.scene = prev
            update_shot(db_path, shot_id,
                        still_path=paths["still_path"],
                        thumb_path=paths["thumb_path"],
                        thumb_fresh=True)
        except Exception as e:
            print(f"[Storyboard] Auto-render after panel create failed: {e}")

        self.report({'INFO'}, f"Created shot: {self.shot_name} ({shot_id})")
        return {'FINISHED'}

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)


class STORYBOARD_OT_render_shot(bpy.types.Operator):
    """Render current shot: still.png + thumb.jpg"""
    bl_idname = "storyboard.render_shot"
    bl_label = "Render Shot"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        scene = context.scene
        if not scene.camera:
            self.report({'ERROR'}, "No camera in scene")
            return {'CANCELLED'}

        # Find shot in DB by scene name
        db_path = get_db_path(project_dir)
        shots = get_all_shots(db_path)
        shot = next((s for s in shots if s["scene_name"] == scene.name), None)
        if not shot:
            self.report({'ERROR'}, f"Scene {scene.name} not in storyboard DB")
            return {'CANCELLED'}

        shot_dir = os.path.join(project_dir, "shots", f"{shot['name']}_{shot['id']}")

        # Render via shared logic (same as web rerender path)
        from core.render import render_shot_files
        paths = render_shot_files(scene, shot_dir)
        still_path = paths["still_path"]
        thumb_path = paths["thumb_path"]

        # Update DB
        update_shot(db_path, shot["id"],
                    still_path=still_path,
                    thumb_path=thumb_path,
                    thumb_fresh=True)

        self.report({'INFO'}, f"Rendered: {shot['name']}")
        return {'FINISHED'}


class STORYBOARD_OT_snap_frame(bpy.types.Operator):
    """拍当前帧：时间轴停在哪个帧就拍哪个帧，图按帧号自动排序（v0.8.0）。
    同帧号已有图 → 弹确认后覆盖；满 5 张且是新帧号 → 软提示，不入队。"""
    bl_idname = "storyboard.snap_frame"
    bl_label = "拍当前帧"
    bl_options = {'REGISTER'}

    frame_no: bpy.props.IntProperty()
    shot_id: StringProperty()
    project_dir: StringProperty()
    overwrite: bpy.props.BoolProperty(default=False)

    def _resolve(self, context):
        """按当前场景/时间轴解析 shot 与帧号；失败时 report 并返回 False。"""
        from core.db import get_frames, MAX_FRAMES_PER_SHOT
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return False
        scene = context.scene
        if not scene.camera:
            self.report({'ERROR'}, "No camera in scene")
            return False
        db_path = get_db_path(project_dir)
        shot = next((s for s in get_all_shots(db_path) if s["scene_name"] == scene.name), None)
        if not shot:
            self.report({'ERROR'}, f"Scene {scene.name} not in storyboard DB")
            return False
        self.project_dir = project_dir
        self.shot_id = shot["id"]
        self.frame_no = scene.frame_current
        frames = get_frames(db_path, shot["id"])
        self.overwrite = any(f["frame_no"] == self.frame_no for f in frames)
        if not self.overwrite and len(frames) >= MAX_FRAMES_PER_SHOT:
            self.report({'WARNING'},
                        f"最多 {MAX_FRAMES_PER_SHOT} 张：跳到已有帧号上覆盖重拍，或先到网页端删一帧")
            return False
        return True

    def invoke(self, context, event):
        if not self._resolve(context):
            return {'CANCELLED'}
        if self.overwrite:
            return context.window_manager.invoke_confirm(self, event)
        return self.execute(context)

    def execute(self, context):
        from core.queue import cmd_render_frame
        # 兜底：execute 被直接调用（脚本/快捷键/EXEC 上下文）且未带属性时，现场解析，
        # 否则空 project_dir 会让 sqlite 在 CWD 造出一个空白 shots.db
        if not self.project_dir or not self.shot_id:
            if not self._resolve(context):
                return {'CANCELLED'}
        try:
            cmd_render_frame({
                "scene_name": context.scene.name,
                "shot_id": self.shot_id,
                "project_dir": self.project_dir,
                "frame_no": self.frame_no,
            })
        except Exception as e:
            self.report({'ERROR'}, f"拍屏失败: {e}")
            return {'CANCELLED'}
        verb = "覆盖重拍" if self.overwrite else "拍屏"
        self.report({'INFO'}, f"F{self.frame_no} {verb}完成")
        return {'FINISHED'}


class STORYBOARD_OT_jump_frame(bpy.types.Operator):
    """时间轴跳到该帧：查看构图 / 停在该帧重拍（v0.8.0）"""
    bl_idname = "storyboard.jump_frame"
    bl_label = "Jump to Frame"
    bl_options = {'REGISTER', 'UNDO'}

    frame_no: bpy.props.IntProperty()

    def execute(self, context):
        context.scene.frame_set(self.frame_no)
        return {'FINISHED'}


class STORYBOARD_OT_render_all(bpy.types.Operator):
    """Render all shots"""
    bl_idname = "storyboard.render_all"
    bl_label = "Render All Shots"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        db_path = get_db_path(project_dir)
        shots = get_all_shots(db_path)
        original_scene = context.scene

        for shot in shots:
            scene = bpy.data.scenes.get(shot["scene_name"])
            if not scene or not scene.camera:
                continue

            context.window.scene = scene
            bpy.ops.storyboard.render_shot()

        context.window.scene = original_scene
        self.report({'INFO'}, f"Rendered {len(shots)} shots")
        return {'FINISHED'}


class STORYBOARD_OT_delete_shot(bpy.types.Operator):
    """Delete current shot: remove Scene + DB record + files"""
    bl_idname = "storyboard.delete_shot"
    bl_label = "Delete Shot"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        scene = context.scene
        db_path = get_db_path(project_dir)
        shots = get_all_shots(db_path)
        shot = next((s for s in shots if s["scene_name"] == scene.name), None)
        if not shot:
            self.report({'ERROR'}, "Scene not in storyboard DB")
            return {'CANCELLED'}

        # Delete files (new {name}_{id} format, with old-format fallback)
        from core.paths import remove_shot_dirs
        remove_shot_dirs(project_dir, shot["name"], shot["id"])

        # Delete DB record
        delete_shot(db_path, shot["id"])

        # Delete scene —— 复用 queue 的安全删除路径（v0.8.2 崩溃修复）：
        # cmd_delete_shot 会先把当前激活场景切走再 batch_remove。
        # 面板路径之前直接 batch_remove，删除"正在激活的场景"时
        # window 仍引用被删的 datablock → Blender 4.5 必崩。
        from core.queue import cmd_delete_shot
        cmd_delete_shot({
            "scene_name": scene.name,
            "shot_name": shot["name"],
            "shot_id": shot["id"],
            "project_dir": project_dir,
        })

        self.report({'INFO'}, f"Deleted shot: {shot['name']}")
        return {'FINISHED'}


# --- Panel ---

# 面板 DB 读取缓存（v0.8.0）：draw 频率极高，DB 可能在 SMB 盘上，1s TTL 足够跟手
_panel_db_cache = {"ts": 0.0, "key": None, "shot": None, "frames": []}


def _panel_db_read(project_dir, scene_name):
    import time
    now = time.monotonic()
    c = _panel_db_cache
    if c["key"] == (project_dir, scene_name) and now - c["ts"] < 1.0:
        return c["shot"], c["frames"]
    shot, frames = None, []
    try:
        from core.db import get_frames
        db_path = get_db_path(project_dir)
        shot = next((s for s in get_all_shots(db_path) if s["scene_name"] == scene_name), None)
        if shot:
            frames = get_frames(db_path, shot["id"])
    except Exception as e:
        print(f"[Storyboard] panel DB read failed: {e}")
    c.update(ts=now, key=(project_dir, scene_name), shot=shot, frames=frames)
    return shot, frames


class STORYBOARD_PT_panel(bpy.types.Panel):
    bl_idname = "VIEW3D_PT_storyboard"
    bl_label = "Storyboard Designer"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Storyboard"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        # Project status
        project_dir = _get_project_dir()
        if project_dir and os.path.exists(project_dir):
            layout.label(text=f"Project: {os.path.basename(project_dir)}", icon='FILE_FOLDER')
        elif project_dir:
            layout.label(text="Project not initialized", icon='ERROR')
        else:
            layout.label(text="Save blend file first", icon='ERROR')

        row = layout.row(align=True)
        row.operator("storyboard.init_project", icon='FILE_NEW')

        # Server status (插件加载即自动服务，无需手动开关)
        server = get_server()
        if server and server.running:
            layout.label(text=f"Server: 0.0.0.0:{server.port} (LAN)", icon='URL')
            layout.operator("storyboard.open_manager", icon='URL')
        else:
            layout.label(text="Server: starting...", icon='TIME')
            layout.operator("storyboard.open_manager", icon='URL')

        layout.separator()

        # Shot management
        layout.operator("storyboard.create_shot", icon='ADD')
        layout.operator("storyboard.render_shot", icon='RENDER_STILL')
        layout.operator("storyboard.render_all", icon='RENDER_ANIMATION')
        layout.operator("storyboard.delete_shot", icon='TRASH')
        layout.operator("storyboard.sync_scenes", icon='FILE_REFRESH')

        layout.separator()

        # Current scene info
        if scene.camera:
            layout.label(text=f"Scene: {scene.name}", icon='SCENE_DATA')
            layout.label(text=f"Camera: {scene.camera.name}", icon='CAMERA_DATA')
        else:
            layout.label(text="No camera", icon='ERROR')

        # 多图镜头（v0.8.0）：拍当前帧 + 已拍帧号列表（点帧号跳转查看/重拍）
        if project_dir and os.path.exists(project_dir) and scene.camera:
            shot, frames = _panel_db_read(project_dir, scene.name)
            if shot:
                layout.separator()
                layout.operator("storyboard.snap_frame", icon='RENDER_STILL')
                if frames:
                    from core.db import MAX_FRAMES_PER_SHOT
                    col = layout.column(align=True)
                    col.label(text=f"已拍帧 ({len(frames)}/{MAX_FRAMES_PER_SHOT}):", icon='SEQUENCE')
                    row = col.row(align=True)
                    for f in frames:
                        missing = not f["image_path"] or not os.path.exists(f["image_path"])
                        icon = 'ERROR' if missing else ('IMAGE_DATA' if f["is_cover"] else 'NONE')
                        row.operator("storyboard.jump_frame",
                                     text=f"F{f['frame_no']}", icon=icon).frame_no = f["frame_no"]


# --- Registration ---

classes = (
    STORYBOARD_OT_sync_scenes,
    STORYBOARD_OT_init_project,
    STORYBOARD_OT_start_server,
    STORYBOARD_OT_stop_server,
    STORYBOARD_OT_open_manager,
    STORYBOARD_OT_create_shot,
    STORYBOARD_OT_render_shot,
    STORYBOARD_OT_snap_frame,
    STORYBOARD_OT_jump_frame,
    STORYBOARD_OT_render_all,
    STORYBOARD_OT_delete_shot,
    STORYBOARD_PT_panel,
)


# --- Auto-start server: 插件加载即服务，跟随文件加载/首次保存 ---
def _auto_start_server():
    try:
        project_dir = _get_project_dir()
        if not project_dir:
            return None  # 文件还没保存过，等 save_post
        server = get_server()
        if server and server.running and server.project_dir == project_dir:
            return None
        start_server(project_dir, port=8089)
        ensure_timer()
        print(f"[Storyboard] auto-started on port {get_server().port}")
    except Exception as e:
        print(f"[Storyboard] auto-start failed: {e}")
    return None  # timer 只跑一次


# --- Auto-sync: 定期同步场景→DB，防止意外退出丢数据 ---
def _auto_sync():
    try:
        from core.sync import sync_scenes_with_db
        sync_scenes_with_db()
    except Exception:
        pass  # 静默失败，不打扰用户
    return 30.0  # 每 30 秒同步一次


@bpy.app.handlers.persistent
def _on_file_loaded(*_args):
    bpy.app.timers.register(_auto_start_server, first_interval=0.5)
    bpy.app.timers.register(_auto_sync, first_interval=5.0)  # 5秒后首次，之后每30秒


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.app.handlers.load_post.append(_on_file_loaded)
    bpy.app.handlers.save_post.append(_on_file_loaded)
    # 插件在已打开文件里启用时立即尝试
    bpy.app.timers.register(_auto_start_server, first_interval=0.5)


def unregister():
    stop_server()
    for h in (bpy.app.handlers.load_post, bpy.app.handlers.save_post):
        if _on_file_loaded in h:
            h.remove(_on_file_loaded)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
