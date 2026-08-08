"""Scene/DB/disk three-way sync — single implementation.

Used by BOTH the panel operator (storyboard.sync_scenes) and the web queue
command (cmd_sync_scenes). Blender file is the authority: DB records for
missing scenes are removed, duplicate records per scene are deduplicated,
new non-storyboard scenes (manual / ghost) are registered as origin='other',
and orphan/legacy directories on disk are cleaned or migrated.

v0.9.25 心跳自动对账：sync_scenes_light() 每 5s 由主线程 timer 跑一次——
场景 ↔ DB 记录双向收敛（登记新场景 / 删孤儿记录 / 去重 / orphan frames），
不做磁盘目录清理（rmtree 只留在启动/手动完整 sync）。sync_scenes_with_db()
保留完整版（含目录清理/迁移），启动时跑一次。
"""
import os
import shutil
import sqlite3
from datetime import datetime
import bpy

from core.db import get_db_path, delete_shot, get_all_shots, create_shot
from core.paths import get_project_dir, shot_dir_rel, remove_shot_dirs

_RECENT_WINDOW = 5.0  # 孤儿删除保护窗：updated_at 距今 < 5s 的记录不删（创建竞态保护）


def _recently_created(updated_at):
    """updated_at 距今 < _RECENT_WINDOW 秒 → True。

    创建镜头是 DB 记录先行、场景后建（queue 命令）——心跳 sync 可能在这个
    窗口里看到\"DB 有记录但场景不存在\"而误删新记录（镜头变\"其它\"再被登记）。
    保护窗让新记录至少存活 5s 再被对账。"""
    try:
        ts = datetime.fromisoformat(updated_at)
        return (datetime.now() - ts).total_seconds() < _RECENT_WINDOW
    except Exception:
        return False


def _register_other_scenes(db_path):
    """把 Blender 场景中 DB 没有记录的（手动建 / 幽灵 / 正名幽灵）登记为
    origin='other'——「其它」页面数据源。__trash__ 前缀跳过（垃圾桶专用，
    deleted=1 记录仍在 DB）。返回登记数。"""
    existing = {s["scene_name"] for s in get_all_shots(db_path, include_deleted=True)}
    registered = 0
    for scene in bpy.data.scenes:
        sn = scene.name
        if sn.startswith("__trash__"):
            continue
        if sn in existing:
            continue
        create_shot(db_path, sn, sn,
                    camera=scene.camera.name if scene.camera else "",
                    origin="other")
        print(f"[Storyboard] Registered other scene: {sn}")
        registered += 1
    return registered


def _reconcile_scenes(db_path, project_dir, existing_scenes, clean_dirs):
    """对账核心（light/完整共用）：删孤儿记录（时间窗保护）+ 按 scene_name 去重
    + orphan frames + 登记其它场景。clean_dirs=True 时顺带删孤儿记录/去重 loser
    的镜头目录（完整 sync 才开，心跳不碰磁盘）。返回 (removed, deduped,
    frames_removed, registered)。"""
    removed = 0
    deduped = 0

    # Remove DB records for missing scenes
    shots = get_all_shots(db_path)
    for shot in shots:
        if shot["scene_name"] not in existing_scenes:
            if _recently_created(shot.get("updated_at") or ""):
                print(f"[Storyboard] Skipping fresh record (creation window): {shot['name']}")
                continue
            print(f"[Storyboard] Removing orphan DB record: {shot['name']} (scene={shot['scene_name']})")
            delete_shot(db_path, shot["id"])
            if clean_dirs:
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
        if clean_dirs:
            remove_shot_dirs(project_dir, loser["name"], loser["id"])
        scene_map[scene_name] = winner
        deduped += 1

    # Orphan frames: shot rows purged earlier (or by older versions without
    # cascade) must not leave frames rows behind (v0.7.0 接手审计发现)
    con = sqlite3.connect(db_path)
    cur = con.execute(
        "DELETE FROM frames WHERE NOT EXISTS "
        "(SELECT 1 FROM shots s WHERE s.id = frames.shot_id)")
    frames_removed = cur.rowcount
    if frames_removed:
        print(f"[Storyboard] Removed {frames_removed} orphan frames rows")
    con.commit()
    con.close()

    # Register non-storyboard scenes (manual / ghost / 正名幽灵) as origin='other'
    registered = _register_other_scenes(db_path)

    return removed, deduped, frames_removed, registered


def sync_scenes_light():
    """轻量对账（心跳 timer 每 5s 用）：场景 ↔ DB 双向收敛，不碰磁盘目录。
    返回 (removed, deduped, frames_removed, registered)。"""
    project_dir = get_project_dir()
    if not project_dir or not os.path.exists(project_dir):
        return (0, 0, 0, 0)
    db_path = get_db_path(project_dir)
    if not os.path.exists(db_path):
        return (0, 0, 0, 0)
    existing_scenes = {s.name for s in bpy.data.scenes}
    return _reconcile_scenes(db_path, project_dir, existing_scenes, clean_dirs=False)


def sync_scenes_with_db():
    """完整 sync（启动/手动）：轻量对账 + 磁盘孤儿目录清理/迁移。
    返回 (removed, orphan_scenes, deduped, dirs_removed, dirs_migrated,
    frames_removed, registered)。"""
    empty = (0, [], 0, 0, 0, 0, 0)
    project_dir = get_project_dir()
    if not project_dir or not os.path.exists(project_dir):
        return empty
    db_path = get_db_path(project_dir)
    if not os.path.exists(db_path):
        return empty

    existing_scenes = {s.name for s in bpy.data.scenes}
    removed, deduped, frames_removed, registered = _reconcile_scenes(
        db_path, project_dir, existing_scenes, clean_dirs=True)

    # 登记后不再有\"Shot_ 前缀但 DB 无记录\"的场景（正名幽灵已入库 origin='other'），
    # 保留该返回字段仅为向后兼容（恒为空列表）
    orphan_scenes = []

    # Clean orphan directories on disk; migrate legacy {id} dirs to {name}_{id}
    # (include_deleted: trash-bin shots keep their directories)
    shots_dir = os.path.join(project_dir, "shots")
    all_shots = get_all_shots(db_path, include_deleted=True)
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

    return (removed, orphan_scenes, deduped, dirs_removed, dirs_migrated,
            frames_removed, registered)
