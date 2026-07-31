"""Shared render logic: still.png + thumb.jpg generation.

Single source of truth used by BOTH the Blender panel operator
(STORYBOARD_OT_render_shot) and the web-queue path (cmd_rerender_shot).
Having one implementation prevents the two paths from diverging.
"""
import os
import bpy


def render_shot_files(scene, shot_dir, thumb_width=320):
    """Render still.png and thumb.jpg for a scene into shot_dir.

    Must be called from the Blender main thread (uses bpy.ops.render.render).

    Returns dict with still_path and thumb_path.
    """
    os.makedirs(shot_dir, exist_ok=True)

    # Render still
    still_path = os.path.join(shot_dir, "still.png")
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = still_path
    scene.render.engine = 'BLENDER_WORKBENCH'
    bpy.ops.render.render(write_still=True, scene=scene.name)

    # Generate thumbnail
    thumb_path = os.path.join(shot_dir, "thumb.jpg")
    img = bpy.data.images.load(still_path)
    w, h = img.size
    if w > thumb_width:
        scale = thumb_width / w
        img.scale(thumb_width, int(h * scale))
    img.filepath_raw = thumb_path
    img.file_format = 'JPEG'
    img.save()
    bpy.data.images.remove(img)

    return {"still_path": still_path, "thumb_path": thumb_path}
