bl_info = {
    "name": "Storyboard Designer",
    "author": "Hermes",
    "version": (0, 1, 0),
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


# --- Project Management ---

class STORYBOARD_OT_init_project(bpy.types.Operator):
    """Initialize storyboard project in current blend file directory"""
    bl_idname = "storyboard.init_project"
    bl_label = "Init Project"
    bl_options = {'REGISTER'}

    def execute(self, context):
        blend_path = bpy.data.filepath
        if not blend_path:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        project_dir = os.path.dirname(blend_path)
        db_path = init_db(os.path.join(project_dir, "shots.db"))

        # Create project.json
        project_json = os.path.join(project_dir, "project.json")
        if not os.path.exists(project_json):
            with open(project_json, "w") as f:
                json.dump({
                    "name": os.path.basename(project_dir),
                    "fps": context.scene.render.fps,
                    "resolution_x": context.scene.render.resolution_x,
                    "resolution_y": context.scene.render.resolution_y,
                }, f, indent=2)

        context.scene.storyboard_project_dir = project_dir
        self.report({'INFO'}, f"Project initialized: {project_dir}")
        return {'FINISHED'}


class STORYBOARD_OT_start_server(bpy.types.Operator):
    """Start HTTP server for storyboard grid"""
    bl_idname = "storyboard.start_server"
    bl_label = "Start Server"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = context.scene.storyboard_project_dir
        if not project_dir:
            self.report({'ERROR'}, "Init project first")
            return {'CANCELLED'}

        server = start_server(project_dir, port=8089)
        ensure_timer()  # Start main thread queue consumer
        self.report({'INFO'}, f"Server on 127.0.0.1:8089")
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


# --- Shot Management ---

class STORYBOARD_OT_create_shot(bpy.types.Operator):
    """Create new shot: new Scene + camera + metadata"""
    bl_idname = "storyboard.create_shot"
    bl_label = "Create Shot"
    bl_options = {'REGISTER', 'UNDO'}

    shot_name: StringProperty(name="Shot Name", default="SH010")
    duration: FloatProperty(name="Duration", default=2.0, min=0.1)
    shot_type: EnumProperty(
        name="Type",
        items=[('3d', "3D", ""), ('2d', "2D", ""), ('mixed', "Mixed", "")],
        default='3d'
    )

    def execute(self, context):
        project_dir = context.scene.storyboard_project_dir
        if not project_dir:
            self.report({'ERROR'}, "Init project first")
            return {'CANCELLED'}

        # Create scene
        scene_name = f"Shot_{self.shot_name}"
        if scene_name in bpy.data.scenes:
            self.report({'ERROR'}, f"Scene {scene_name} already exists")
            return {'CANCELLED'}

        new_scene = bpy.data.scenes.new(name=scene_name)
        new_scene.render.fps = context.scene.render.fps
        new_scene.render.resolution_x = context.scene.render.resolution_x
        new_scene.render.resolution_y = context.scene.render.resolution_y

        # Create camera
        cam_data = bpy.data.cameras.new(name=f"Cam_{self.shot_name}")
        cam_obj = bpy.data.objects.new(name=f"Cam_{self.shot_name}", object_data=cam_data)
        new_scene.collection.objects.link(cam_obj)
        new_scene.camera = cam_obj
        cam_obj.location = (7, -7, 5)
        cam_obj.rotation_euler = (1.1, 0, 0.785)

        # Create DB record
        db_path = get_db_path(project_dir)
        shot_id = create_shot(db_path, self.shot_name, scene_name,
                              camera=cam_obj.name, duration=self.duration,
                              shot_type=self.shot_type)

        # Create shot directory
        shot_dir = os.path.join(project_dir, "shots", shot_id)
        os.makedirs(shot_dir, exist_ok=True)

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
        project_dir = context.scene.storyboard_project_dir
        if not project_dir:
            self.report({'ERROR'}, "Init project first")
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

        shot_dir = os.path.join(project_dir, "shots", shot["id"])
        os.makedirs(shot_dir, exist_ok=True)

        # Render still
        still_path = os.path.join(shot_dir, "still.png")
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = still_path
        bpy.ops.render.opengl(write_still=True)

        # Generate thumbnail (320px wide)
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
        update_shot(db_path, shot["id"],
                    still_path=still_path,
                    thumb_path=thumb_path)

        self.report({'INFO'}, f"Rendered: {shot['name']}")
        return {'FINISHED'}


class STORYBOARD_OT_render_all(bpy.types.Operator):
    """Render all shots"""
    bl_idname = "storyboard.render_all"
    bl_label = "Render All Shots"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = context.scene.storyboard_project_dir
        if not project_dir:
            self.report({'ERROR'}, "Init project first")
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
        project_dir = context.scene.storyboard_project_dir
        if not project_dir:
            self.report({'ERROR'}, "Init project first")
            return {'CANCELLED'}

        scene = context.scene
        db_path = get_db_path(project_dir)
        shots = get_all_shots(db_path)
        shot = next((s for s in shots if s["scene_name"] == scene.name), None)
        if not shot:
            self.report({'ERROR'}, "Scene not in storyboard DB")
            return {'CANCELLED'}

        # Delete files
        shot_dir = os.path.join(project_dir, "shots", shot["id"])
        if os.path.exists(shot_dir):
            import shutil
            shutil.rmtree(shot_dir)

        # Delete DB record
        delete_shot(db_path, shot["id"])

        # Delete scene
        bpy.data.scenes.remove(scene)

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
        project_dir = scene.storyboard_project_dir
        if project_dir:
            layout.label(text=f"Project: {os.path.basename(project_dir)}", icon='FILE_FOLDER')
        else:
            layout.label(text="No project", icon='ERROR')

        row = layout.row(align=True)
        row.operator("storyboard.init_project", icon='FILE_NEW')
        row.operator("storyboard.start_server", icon='PLAY')
        row.operator("storyboard.stop_server", icon='PAUSE')

        # Server status
        server = get_server()
        if server and server.running:
            layout.label(text="Server: 127.0.0.1:8089", icon='URL')
        else:
            layout.label(text="Server: stopped", icon='X')

        layout.separator()

        # Shot management
        layout.operator("storyboard.create_shot", icon='ADD')
        layout.operator("storyboard.render_shot", icon='RENDER_STILL')
        layout.operator("storyboard.render_all", icon='RENDER_ANIMATION')
        layout.operator("storyboard.delete_shot", icon='TRASH')

        layout.separator()

        # Current scene info
        if scene.camera:
            layout.label(text=f"Scene: {scene.name}", icon='SCENE_DATA')
            layout.label(text=f"Camera: {scene.camera.name}", icon='CAMERA_DATA')
        else:
            layout.label(text="No camera", icon='ERROR')


# --- Registration ---

classes = (
    STORYBOARD_OT_init_project,
    STORYBOARD_OT_start_server,
    STORYBOARD_OT_stop_server,
    STORYBOARD_OT_create_shot,
    STORYBOARD_OT_render_shot,
    STORYBOARD_OT_render_all,
    STORYBOARD_OT_delete_shot,
    STORYBOARD_PT_panel,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)

    bpy.types.Scene.storyboard_project_dir = StringProperty(
        name="Project Directory",
        description="Storyboard project root directory",
        default="",
        subtype='DIR_PATH'
    )


def unregister():
    stop_server()
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)

    del bpy.types.Scene.storyboard_project_dir


if __name__ == "__main__":
    register()
