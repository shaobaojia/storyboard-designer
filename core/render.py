"""Shared render logic: still.png + thumb.jpg generation.

Single source of truth used by BOTH the Blender panel operator
(STORYBOARD_OT_render_shot) and the web-queue path (cmd_rerender_shot).
Having one implementation prevents the two paths from diverging.
"""
import os
import bpy


def render_shot_files(scene, shot_dir, thumb_width=320, frame_no=None):
    """Render still.png and thumb.jpg for a scene into shot_dir.

    Uses viewport OpenGL render ("视图渲染图像") — WYSIWYG, what you see in
    the viewport is what you get. Requires a valid 3D viewport context, so
    must be called from the Blender main thread with a window.

    frame_no=None renders the legacy still.png/thumb.jpg pair (single-frame
    shots, backward compatible). With frame_no set, the timeline jumps to
    that frame first and outputs fNNNNN_still.png / fNNNNN_thumb.jpg.

    Returns dict with still_path and thumb_path.
    """
    os.makedirs(shot_dir, exist_ok=True)

    # Multi-frame: jump the timeline to the requested frame before rendering
    if frame_no is not None:
        scene.frame_set(frame_no)

    # Viewport OpenGL render (拍屏, "视图渲染图像") — matches what user sees
    if frame_no is None:
        still_path = os.path.join(shot_dir, "still.png")
    else:
        still_path = os.path.join(shot_dir, f"f{frame_no:05d}_still.png")
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = still_path

    # opengl render needs a 3D viewport area. Force camera view so it renders
    # the scene's camera angle, not whatever the viewport happens to show.
    view3d_area = None
    view3d_region = None
    try:
        for area in bpy.context.window.screen.areas:
            if area.type == 'VIEW_3D':
                view3d_area = area
                for region in area.regions:
                    if region.type == 'WINDOW':
                        view3d_region = region
                        break
                break
    except Exception:
        pass

    if view3d_area and view3d_region and scene.camera:
        # Force camera view for render.opengl (it reads the real viewport).
        # Setting region_3d.view_perspective directly works; view3d.view_camera()
        # operator fails inside temp_override with poll error.
        space = view3d_area.spaces.active
        old_perspective = space.region_3d.view_perspective

        space.region_3d.view_perspective = 'CAMERA'
        view3d_area.tag_redraw()

        with bpy.context.temp_override(
            area=view3d_area,
            region=view3d_region,
            scene=scene,
        ):
            bpy.ops.render.opengl(write_still=True)

        space.region_3d.view_perspective = old_perspective
        view3d_area.tag_redraw()
    elif view3d_area and view3d_region:
        # No camera set, render perspective as-is
        with bpy.context.temp_override(area=view3d_area, region=view3d_region, scene=scene):
            bpy.ops.render.opengl(write_still=True)
    else:
        # No 3D viewport available (e.g. MCP thread, no window): fall back to
        # standard workbench render so the call doesn't fail outright
        scene.render.engine = 'BLENDER_WORKBENCH'
        bpy.ops.render.render(write_still=True, scene=scene.name)

    # Generate thumbnail
    if frame_no is None:
        thumb_path = os.path.join(shot_dir, "thumb.jpg")
    else:
        thumb_path = os.path.join(shot_dir, f"f{frame_no:05d}_thumb.jpg")
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
