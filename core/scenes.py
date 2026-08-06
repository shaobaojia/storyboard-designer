"""Blender scene factory for shots — single source of truth.

Panel operators and queue commands both create shot scenes; the camera
preset (location/rotation) and the optional background-image attach used to
be copy-pasted in three places. Keep it here, once.
"""
import os
import json
import bpy

DEFAULT_CAM_LOCATION = (7, -7, 5)
DEFAULT_CAM_ROTATION = (1.1, 0, 0.785)


def _project_resolution():
    """画幅比/分辨率设置（v0.9.7）：读当前项目 project.json。
    返回 (w, h) 或 None（无项目/无字段/坏文件 → 不动场景默认分辨率）。
    用 bpy.data.filepath 推导 project_dir（pitfall 49：零转义）。"""
    try:
        blend = bpy.data.filepath
        if not blend:
            return None
        project_dir = os.path.join(
            os.path.dirname(blend),
            os.path.splitext(os.path.basename(blend))[0] + "_storyboard")
        with open(os.path.join(project_dir, "project.json"), encoding="utf-8") as f:
            pj = json.load(f)
        w, h = int(pj["resolution_x"]), int(pj["resolution_y"])
        return (w, h) if w > 0 and h > 0 else None
    except Exception:
        return None


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
    else:
        # v0.9.7：无模板时按项目画幅设置（网页/API 创建路径）
        res = _project_resolution()
        if res:
            new_scene.render.resolution_x, new_scene.render.resolution_y = res

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
