"""Scene/DB/disk three-way sync — single implementation.

Used by BOTH the panel operator (storyboard.sync_scenes) and the web queue
command (cmd_sync_scenes). Blender file is the authority: DB records for
missing scenes are removed, duplicate records per scene are deduplicated,
and orphan/legacy directories on disk are cleaned or migrated.
"""
import os
import shutil
import bpy

from core.db import get_db_path, delete_shot, get_all_shots
from core.paths import get_project_dir, shot_dir_rel, remove_shot_dirs


def sync_scenes_with_db():
    """Sync Blender scenes with DB records.

    Returns (removed, orphan_scenes, deduped, dirs_removed, dirs_migrated).
    """
    empty = (0, [], 0, 0, 0)
    project_dir = get_project_dir()
    if not project_dir or not os.path.exists(project_dir):
        return empty

    db_path = get_db_path(project_dir)
    if not os.path.exists(db_path):
        return empty

    shots = get_all_shots(db_path)
    removed = 0
    deduped = 0
    orphan_scenes = []
    existing_scenes = {s.name for s in bpy.data.scenes}

    # Remove DB records for missing scenes (+ their files)
    for shot in shots:
        if shot["scene_name"] not in existing_scenes:
            print(f"[Storyboard] Removing orphan DB record: {shot['name']} (scene={shot['scene_name']})")
            delete_shot(db_path, shot["id"])
            remove_shot_dirs(project_dir, shot["name"], shot["id"])
            removed += 1

    # Deduplicate: keep only latest record per scene_name
    shots = get_all_shots(db_path)
    scene_map = {}
    for shot in shots:
        scene_name = shot["scene_name"]
        if scene_name not in scene_map:
            scene_map[scene_name] = shot
            continue
        existing = scene_map[scene_name]
        if shot["updated_at"] > existing["updated_at"]:
            loser, winner = existing, shot
        else:
            loser, winner = shot, existing
        print(f"[Storyboard] Deduplicating: removing older record for {scene_name} (id={loser['id'][:8]})")
        delete_shot(db_path, loser["id"])
        remove_shot_dirs(project_dir, loser["name"], loser["id"])
        scene_map[scene_name] = winner
        deduped += 1

    # Scenes not tracked in DB (potential manual imports)
    db_scene_names = {s["scene_name"] for s in get_all_shots(db_path)}
    for scene_name in existing_scenes:
        if scene_name.startswith("Shot_") and scene_name not in db_scene_names:
            orphan_scenes.append(scene_name)

    # Clean orphan directories on disk; migrate legacy {id} dirs to {name}_{id}
    shots_dir = os.path.join(project_dir, "shots")
    all_shots = get_all_shots(db_path)
    valid_ids = {s["id"] for s in all_shots}
    id_to_name = {s["id"]: s["name"] for s in all_shots}
    dirs_removed = 0
    dirs_migrated = 0
    if os.path.isdir(shots_dir):
        for d in list(os.listdir(shots_dir)):
            full = os.path.join(shots_dir, d)
            if not os.path.isdir(full):
                continue
            # Extract id: new format is everything after the last underscore
            dir_id = d.rsplit("_", 1)[-1] if "_" in d else d
            if dir_id not in valid_ids:
                print(f"[Storyboard] Removing orphan directory: {d}")
                shutil.rmtree(full)
                dirs_removed += 1
            elif d == dir_id:
                new_name = shot_dir_rel(id_to_name[dir_id], dir_id)
                new_full = os.path.join(shots_dir, new_name)
                if not os.path.exists(new_full):
                    print(f"[Storyboard] Migrating legacy dir: {d} -> {new_name}")
                    os.rename(full, new_full)
                else:
                    print(f"[Storyboard] Merging legacy dir: {d} -> {new_name}")
                    for f in os.listdir(full):
                        src = os.path.join(full, f)
                        dst = os.path.join(new_full, f)
                        if not os.path.exists(dst):
                            os.rename(src, dst)
                    shutil.rmtree(full)
                dirs_migrated += 1

    return removed, orphan_scenes, deduped, dirs_removed, dirs_migrated
