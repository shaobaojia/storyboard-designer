bl_info = {
    "name": "Storyboard Designer",
    "author": "Hermes",
    "version": (0, 6, 2),
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
        removed, orphans, deduped, dirs_removed, dirs_migrated = sync_scenes_with_db()
        msg = f"Removed {removed} orphan records"
        if deduped:
            msg += f", deduped {deduped} duplicates"
        if dirs_removed:
            msg += f", cleaned {dirs_removed} orphan dirs"
        if dirs_migrated:
            msg += f", migrated {dirs_migrated} legacy dirs"
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

        # Delete scene（重场景瞬删：batch_remove + 临时关全局撤销，避免整文件撤销快照卡死）
        prefs = bpy.context.preferences.edit
        undo_was = prefs.use_global_undo
        prefs.use_global_undo = False
        try:
            bpy.data.batch_remove(ids=(scene,))
        finally:
            prefs.use_global_undo = undo_was

        self.report({'INFO'}, f"Deleted shot: {shot['name']}")
        return {'FINISHED'}


# --- Panel ---

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


# --- Registration ---

classes = (
    STORYBOARD_OT_sync_scenes,
    STORYBOARD_OT_init_project,
    STORYBOARD_OT_start_server,
    STORYBOARD_OT_stop_server,
    STORYBOARD_OT_open_manager,
    STORYBOARD_OT_create_shot,
    STORYBOARD_OT_render_shot,
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


@bpy.app.handlers.persistent
def _on_file_loaded(*_args):
    bpy.app.timers.register(_auto_start_server, first_interval=0.5)


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
