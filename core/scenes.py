"""Blender scene factory for shots — single source of truth.

Panel operators and queue commands both create shot scenes; the camera
preset (location/rotation) and the optional background-image attach used to
be copy-pasted in three places. Keep it here, once.
"""
import os
import bpy

DEFAULT_CAM_LOCATION = (7, -7, 5)
DEFAULT_CAM_ROTATION = (1.1, 0, 0.785)


def create_shot_scene(shot_name, scene_name=None, image_path=None,
                      template_scene=None):
    """Create a shot scene + camera. Optionally attach a camera background
    image (always 100% opaque) and copy render settings from a template scene.

    Returns the new scene, or None if scene_name is already taken.
    """
    scene_name = scene_name or f"Shot_{shot_name}"
    if scene_name in bpy.data.scenes:
        return None

    new_scene = bpy.data.scenes.new(name=scene_name)
    if template_scene:
        new_scene.render.fps = template_scene.render.fps
        new_scene.render.resolution_x = template_scene.render.resolution_x
        new_scene.render.resolution_y = template_scene.render.resolution_y

    cam_data = bpy.data.cameras.new(name=f"Cam_{shot_name}")
    cam_obj = bpy.data.objects.new(name=f"Cam_{shot_name}", object_data=cam_data)
    new_scene.collection.objects.link(cam_obj)
    new_scene.camera = cam_obj
    cam_obj.location = DEFAULT_CAM_LOCATION
    cam_obj.rotation_euler = DEFAULT_CAM_ROTATION

    if image_path and os.path.exists(image_path):
        img = bpy.data.images.load(image_path)
        bg = cam_data.background_images.new()
        bg.image = img
        bg.alpha = 1.0  # 100% opaque, always
        cam_data.show_background_images = True

    return new_scene
