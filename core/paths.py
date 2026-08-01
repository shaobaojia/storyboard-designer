"""Shot directory path helpers — single source of truth.

The on-disk layout is {project_dir}/shots/{shot_name}_{shot_id}/, with a
legacy {shot_id}/ format that older projects may still carry. EVERY module
(panel operators, queue commands, HTTP handlers, sync) must build and clean
these paths through here, never inline.
"""
import os
import shutil


def get_project_dir():
    """Derive the project dir from the current blend file path.

    {blend_dir}/{blend_name}_storyboard/ — returns None for unsaved files.
    bpy import is lazy so HTTP-server-side modules can import this file
    without touching bpy at module load time.
    """
    import bpy
    blend_path = bpy.data.filepath
    if not blend_path:
        return None
    blend_dir = os.path.dirname(blend_path)
    blend_name = os.path.splitext(os.path.basename(blend_path))[0]
    return os.path.join(blend_dir, f"{blend_name}_storyboard")


def shot_dir_rel(name, shot_id):
    """Relative shot directory name: {name}_{id}."""
    return f"{name}_{shot_id}"


def shot_dir(project_dir, name, shot_id):
    """Absolute path of the (new-format) shot directory."""
    return os.path.join(project_dir, "shots", shot_dir_rel(name, shot_id))


def shot_dir_candidates(project_dir, name, shot_id):
    """New-format dir + legacy {id} fallback, existing dirs only, in order."""
    root = os.path.join(project_dir, "shots")
    names = [shot_dir_rel(name, shot_id), shot_id] if name else [shot_id]
    return [os.path.join(root, c) for c in names
            if os.path.isdir(os.path.join(root, c))]


def remove_shot_dirs(project_dir, name, shot_id):
    """Remove shot directories (new + legacy formats). Returns count removed."""
    removed = 0
    for p in shot_dir_candidates(project_dir, name, shot_id):
        shutil.rmtree(p)
        removed += 1
    return removed
