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
from core.db import init_db, get_db_path, create_shot, update_shot, delete_shot, get_all_shots, get_shot
from core.server import start_server, stop_server, get_server
from core.queue import queue_command, ensure_timer


def _get_project_dir():
    """Auto-derive project dir from blend file path."""
    blend_path = bpy.data.filepath
    if not blend_path:
        return None
    blend_dir = os.path.dirname(blend_path)
    blend_name = os.path.splitext(os.path.basename(blend_path))[0]
    return os.path.join(blend_dir, f"{blend_name}_storyboard")


def _sync_scenes_with_db():
    """
    Sync Blender scenes with DB records.
    Blender file is authority: remove DB records for missing scenes.
    Also deduplicate: keep only latest record per scene_name.
    Returns (removed_count, orphan_scenes, dedup_count)
    """
    project_dir = _get_project_dir()
    if not project_dir or not os.path.exists(project_dir):
        return 0, [], 0, 0, 0

    db_path = get_db_path(project_dir)
    if not os.path.exists(db_path):
        return 0, [], 0, 0, 0

    shots = get_all_shots(db_path)
    removed = 0
    deduped = 0
    orphan_scenes = []

    # Build set of existing scene names
    existing_scenes = {s.name for s in bpy.data.scenes}

    # Remove DB records for missing scenes
    import shutil
    for shot in shots:
        if shot["scene_name"] not in existing_scenes:
            print(f"[Storyboard] Removing orphan DB record: {shot['name']} (scene={shot['scene_name']})")
            delete_shot(db_path, shot["id"])
            # Clean up shot files (new + old dir formats)
            for cand in (f"{shot['name']}_{shot['id']}", shot["id"]):
                shot_dir = os.path.join(project_dir, "shots", cand)
                if os.path.exists(shot_dir):
                    shutil.rmtree(shot_dir)
            removed += 1

    # Deduplicate: keep only latest record per scene_name
    shots = get_all_shots(db_path)
    scene_map = {}
    for shot in shots:
        scene_name = shot["scene_name"]
        if scene_name not in scene_map:
            scene_map[scene_name] = shot
        else:
            # Keep the one with later updated_at
            existing = scene_map[scene_name]
            if shot["updated_at"] > existing["updated_at"]:
                # Remove old one
                print(f"[Storyboard] Deduplicating: removing older record for {scene_name} (id={existing['id'][:8]})")
                delete_shot(db_path, existing["id"])
                for cand in (f"{existing['name']}_{existing['id']}", existing["id"]):
                    shot_dir = os.path.join(project_dir, "shots", cand)
                    if os.path.exists(shot_dir):
                        shutil.rmtree(shot_dir)
                scene_map[scene_name] = shot
                deduped += 1
            else:
                # Remove current one
                print(f"[Storyboard] Deduplicating: removing older record for {scene_name} (id={shot['id'][:8]})")
                delete_shot(db_path, shot["id"])
                for cand in (f"{shot['name']}_{shot['id']}", shot["id"]):
                    shot_dir = os.path.join(project_dir, "shots", cand)
                    if os.path.exists(shot_dir):
                        shutil.rmtree(shot_dir)
                deduped += 1

    # Find scenes not in DB (potential manual imports)
    db_scene_names = {s["scene_name"] for s in get_all_shots(db_path)}
    for scene_name in existing_scenes:
        if scene_name.startswith("Shot_") and scene_name not in db_scene_names:
            orphan_scenes.append(scene_name)

    # Clean orphan directories on disk: any shots/ dir whose id is not in DB.
    # Dir formats: {name}_{id} (new) or {id} (legacy 8-char hex).
    # Legacy dirs whose id IS valid get migrated to the new format.
    shots_dir = os.path.join(project_dir, "shots")
    all_shots = get_all_shots(db_path)
    valid_ids = {s["id"] for s in all_shots}
    id_to_name = {s["id"]: s["name"] for s in all_shots}
    dirs_removed = 0
    dirs_migrated = 0
    if os.path.exists(shots_dir):
        for d in list(os.listdir(shots_dir)):
            full = os.path.join(shots_dir, d)
            if not os.path.isdir(full):
                continue
            # Extract id: new format is everything after last underscore
            dir_id = d.rsplit("_", 1)[-1] if "_" in d else d
            if dir_id not in valid_ids:
                print(f"[Storyboard] Removing orphan directory: {d}")
                shutil.rmtree(full)
                dirs_removed += 1
            elif d == dir_id:
                # Legacy format {id} for a valid shot -> migrate to {name}_{id}
                new_name = f"{id_to_name[dir_id]}_{dir_id}"
                new_full = os.path.join(shots_dir, new_name)
                if not os.path.exists(new_full):
                    print(f"[Storyboard] Migrating legacy dir: {d} -> {new_name}")
                    os.rename(full, new_full)
                    dirs_migrated += 1
                else:
                    # New-format dir already exists; merge contents then remove legacy
                    print(f"[Storyboard] Merging legacy dir: {d} -> {new_name}")
                    for f in os.listdir(full):
                        src = os.path.join(full, f)
                        dst = os.path.join(new_full, f)
                        if not os.path.exists(dst):
                            os.rename(src, dst)
                    shutil.rmtree(full)
                    dirs_migrated += 1

    return removed, orphan_scenes, deduped, dirs_removed, dirs_migrated


class STORYBOARD_OT_sync_scenes(bpy.types.Operator):
    """Sync Blender scenes with storyboard database"""
    bl_idname = "storyboard.sync_scenes"
    bl_label = "Sync Scenes"
    bl_options = {'REGISTER'}

    def execute(self, context):
        removed, orphans, deduped, dirs_removed, dirs_migrated = _sync_scenes_with_db()
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
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
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

        # Create shot directory with readable name: {shot_name}_{shot_id}/
        shot_dir = os.path.join(project_dir, "shots", f"{self.shot_name}_{shot_id}")
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
                    thumb_path=thumb_path)

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
        import shutil
        for cand in (f"{shot['name']}_{shot['id']}", shot["id"]):
            shot_dir = os.path.join(project_dir, "shots", cand)
            if os.path.exists(shot_dir):
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
        project_dir = _get_project_dir()
        if project_dir and os.path.exists(project_dir):
            layout.label(text=f"Project: {os.path.basename(project_dir)}", icon='FILE_FOLDER')
        elif project_dir:
            layout.label(text="Project not initialized", icon='ERROR')
        else:
            layout.label(text="Save blend file first", icon='ERROR')

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
    STORYBOARD_OT_create_shot,
    STORYBOARD_OT_render_shot,
    STORYBOARD_OT_render_all,
    STORYBOARD_OT_delete_shot,
    STORYBOARD_PT_panel,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    stop_server()
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
