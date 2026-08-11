"""
SQLite data layer for Storyboard Designer.
Single authority: shots.db
"""
import sqlite3
import os
import uuid
from datetime import datetime

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS shots (
    id          TEXT PRIMARY KEY,
    seq         INTEGER NOT NULL,
    name        TEXT,
    scene_name  TEXT,
    camera      TEXT,
    duration    REAL DEFAULT 2.0,
    notes       TEXT,
    content     TEXT DEFAULT '',
    dialogue    TEXT DEFAULT '',
    deleted     INTEGER DEFAULT 0,
    still_path  TEXT,
    thumb_path  TEXT,
    thumb_ver   INTEGER DEFAULT 0,
    updated_at  TEXT,
    origin      TEXT DEFAULT 'storyboard'  -- 场景来源：storyboard=分镜系统创建 / other=其它途径（手动/幽灵）
);

CREATE INDEX IF NOT EXISTS idx_shots_seq ON shots(seq);

CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v INTEGER
);

CREATE TABLE IF NOT EXISTS frames (
    id          TEXT PRIMARY KEY,
    shot_id     TEXT NOT NULL,
    frame_no    INTEGER NOT NULL,
    image_path  TEXT,
    is_cover    INTEGER DEFAULT 0,
    ver         INTEGER DEFAULT 0,
    updated_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_frames_shot ON frames(shot_id);
"""


from contextlib import contextmanager

@contextmanager
def _db(db_path):
    """v0.9.6：统一连接的 try/finally 关闭（任何 SQL 异常都不泄漏连接/悬挂事务）。"""
    conn = sqlite3.connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


def _bump_rev(conn):
    """Every mutation bumps the global revision counter (meta.rev).

    get_db_version reads it — one integer that changes on ANY write
    (including reorders, which no longer touch updated_at)."""
    conn.execute(
        "INSERT INTO meta (k, v) VALUES ('rev', 1) "
        "ON CONFLICT(k) DO UPDATE SET v = v + 1")


def init_db(db_path):
    """Initialize SQLite database with schema."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(DB_SCHEMA)
    # v0.9.71 屎山治理代1：老库迁移三块已删（type 列删除 / orphan_shots 回填 frames /
    # frames.ver 补列 / still.png→thumb.jpg 改指）——不存在旧工程，新库建表即全量。
    # 保留通用补列循环：幂等防御（手工改库/未来加列时空转无害）。
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(shots)").fetchall()]
        for col, ddl in (("content", "TEXT DEFAULT ''"),
                         ("dialogue", "TEXT DEFAULT ''"),
                         ("deleted", "INTEGER DEFAULT 0"),
                         ("thumb_ver", "INTEGER DEFAULT 0"),
                         ("origin", "TEXT DEFAULT 'storyboard'")):
            if col not in cols:
                conn.execute(f"ALTER TABLE shots ADD COLUMN {col} {ddl}")
                print(f"[Storyboard] Migrated DB: added '{col}' column")
    except sqlite3.OperationalError:
        pass  # Very old SQLite: harmless
    conn.commit()
    conn.close()
    return db_path


def get_db_path(project_dir):
    """Get shots.db path for a project directory."""
    return os.path.join(project_dir, "shots.db")


_version_cache = {}


def get_db_version(db_path):
    """Lightweight change marker derived from DB CONTENT (count + latest
    updated_at), not file mtime — network drives (SMB/N:) have coarse,
    cached mtimes that miss real writes. For heartbeat polling.

    Results are cached for 0.8s: heartbeat polls hit this every 1.5s per
    client, and a SQLite open on SMB costs real network round-trips."""
    import time
    now = time.monotonic()
    cached = _version_cache.get(db_path)
    if cached and now - cached[0] < 0.8:
        return cached[1]
    if not os.path.exists(db_path):
        return "0-0"
    try:
        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM shots").fetchone()[0]
        try:
            rev = conn.execute("SELECT v FROM meta WHERE k = 'rev'").fetchone()
            rev = rev[0] if rev else 0
        except sqlite3.Error:
            rev = 0
        conn.close()
        value = f"{count}-{rev}"
    except sqlite3.Error:
        value = "err"
    _version_cache[db_path] = (now, value)
    return value


def create_shot(db_path, name, scene_name, camera="", duration=2.0, shot_id=None, origin="storyboard"):
    """Create a new shot record. Returns shot id (pre-generatable for undo wiring).
    origin: 'storyboard'（分镜系统创建）/ 'other'（其它途径场景登记）"""
    shot_id = shot_id or str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    with _db(db_path) as conn:
        # Get next seq
        cursor = conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM shots")
        seq = cursor.fetchone()[0]

        conn.execute(
            "INSERT INTO shots (id, seq, name, scene_name, camera, duration, notes, still_path, thumb_path, updated_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (shot_id, seq, name, scene_name, camera, duration, "", "", "", now, origin)
        )
        _bump_rev(conn)
        conn.commit()
    return shot_id


def update_shot(db_path, shot_id, **kwargs):
    """Update shot fields. Allowed: seq, name, scene_name, camera, duration, notes, content, dialogue, deleted, still_path, thumb_path.

    Setting a non-empty thumb_path means a fresh render landed — thumb_ver
    auto-increments so the web side refreshes exactly that one image.
    Anything else (rename/reorder/text edits) leaves thumb_ver alone."""
    allowed = {"seq", "name", "scene_name", "camera", "duration", "notes",
               "content", "dialogue", "deleted", "still_path", "thumb_path",
               "origin"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return False

    bump_thumb = bool(kwargs.get("thumb_fresh")) and bool(updates.get("thumb_path"))
    updates["updated_at"] = datetime.now().isoformat()
    set_parts = [f"{k} = ?" for k in updates.keys()]
    values = list(updates.values())
    if bump_thumb:
        set_parts.append("thumb_ver = COALESCE(thumb_ver, 0) + 1")
    set_clause = ", ".join(set_parts)
    values.append(shot_id)

    with _db(db_path) as conn:
        conn.execute(f"UPDATE shots SET {set_clause} WHERE id = ?", values)
        _bump_rev(conn)
        conn.commit()
    return True


def delete_shot(db_path, shot_id):
    """Delete a shot record. Frames rows go first — SQLite FK 默认不启用、
    没有级联，不删就会留下孤儿帧（v0.7.0 接手审计发现）。"""
    with _db(db_path) as conn:
        conn.execute("DELETE FROM frames WHERE shot_id = ?", (shot_id,))
        conn.execute("DELETE FROM shots WHERE id = ?", (shot_id,))
        _bump_rev(conn)
        conn.commit()


def get_shot(db_path, shot_id):
    """Get a single shot by id."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute("SELECT * FROM shots WHERE id = ?", (shot_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_all_shots(db_path, include_deleted=False):
    """Get all shots ordered by seq. Trash rows (deleted=1) excluded by default."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    where = "" if include_deleted else "WHERE deleted = 0"
    cursor = conn.execute(f"SELECT * FROM shots {where} ORDER BY seq")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_trash(db_path):
    """Get soft-deleted shots (the trash bin)."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute("SELECT * FROM shots WHERE deleted = 1 ORDER BY updated_at DESC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_other_scenes(db_path):
    """Get non-storyboard scenes (origin='other'): 手动/幽灵/其它途径场景，
    网页「其它」页面的数据源。按 updated_at 倒序（新出现的在前）。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute(
        "SELECT * FROM shots WHERE origin = 'other' AND deleted = 0 ORDER BY updated_at DESC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def name_exists(db_path, name, exclude_id=None):
    """Check if a shot name is already taken (rename guard)."""
    conn = sqlite3.connect(db_path)
    if exclude_id:
        row = conn.execute("SELECT COUNT(*) FROM shots WHERE name = ? AND id != ?",
                           (name, exclude_id)).fetchone()
    else:
        row = conn.execute("SELECT COUNT(*) FROM shots WHERE name = ?", (name,)).fetchone()
    conn.close()
    return row[0] > 0


def next_c_number(db_path):
    """Next free c-number as int (base for local increments)."""
    import re
    best = 0
    for s in get_all_shots(db_path, include_deleted=True):  # 垃圾桶里的 c 名也算占用
        m = re.fullmatch(r"c(\d+)", s["name"] or "")
        if m:
            best = max(best, int(m.group(1)))
    return best + 10


def next_c_name(db_path):
    """Next c-numbered shot name: c0010, c0020, ... (max existing + 10)."""
    return f"c{next_c_number(db_path):04d}"


def reorder_shots(db_path, shot_ids):
    """Reorder shots by given id list. Updates seq only — NOT updated_at
    (a reorder is not a content edit; bumping updated_at used to rebuild
    every card and reload every thumbnail on the web side)."""
    with _db(db_path) as conn:
        for idx, shot_id in enumerate(shot_ids, start=1):
            conn.execute("UPDATE shots SET seq = ? WHERE id = ?", (idx, shot_id))
        _bump_rev(conn)
        conn.commit()


# ---------- frames (multi-image shots) ----------

MAX_FRAMES_PER_SHOT = 5


def add_frame(db_path, shot_id, frame_no, image_path=None, is_cover=False, frame_id=None):
    """Add a frame to a shot. Enforces the 5-frame cap. Returns frame id.
    Raises ValueError if the shot already has MAX_FRAMES_PER_SHOT frames."""
    with _db(db_path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM frames WHERE shot_id = ?",
                             (shot_id,)).fetchone()[0]
        if count >= MAX_FRAMES_PER_SHOT:
            raise ValueError(f"shot already has {MAX_FRAMES_PER_SHOT} frames (cap)")
        frame_id = frame_id or str(uuid.uuid4())[:8]
        now = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO frames (id, shot_id, frame_no, image_path, is_cover, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (frame_id, shot_id, frame_no, image_path, 1 if is_cover else 0, now))
        _bump_rev(conn)
        conn.commit()
    return frame_id


def update_frame(db_path, frame_id, **kwargs):
    """Update frame fields. Allowed: frame_no, image_path, is_cover.

    A fresh image_path means a re-render landed — the frame-level `ver`
    auto-increments so the web refreshes exactly that one frame's image
    (multi-frame shots: non-cover re-renders must bust the per-frame URL)."""
    allowed = {"frame_no", "image_path", "is_cover"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return False
    updates["updated_at"] = datetime.now().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values())
    if "image_path" in updates:
        set_clause += ", ver = COALESCE(ver, 0) + 1"
    values.append(frame_id)
    with _db(db_path) as conn:
        conn.execute(f"UPDATE frames SET {set_clause} WHERE id = ?", values)
        _bump_rev(conn)
        conn.commit()
    return True


def delete_frame(db_path, frame_id):
    """Delete a frame record (caller's job to remove the disk file)."""
    with _db(db_path) as conn:
        conn.execute("DELETE FROM frames WHERE id = ?", (frame_id,))
        _bump_rev(conn)
        conn.commit()


def get_frames(db_path, shot_id):
    """Get all frames of a shot, ordered by frame_no ascending."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM frames WHERE shot_id = ? ORDER BY frame_no", (shot_id,))]
    conn.close()
    return rows


def get_all_frames(db_path):
    """Get all frames grouped by shot_id: {shot_id: [frame, ...]}."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM frames ORDER BY frame_no")]
    conn.close()
    grouped = {}
    for r in rows:
        grouped.setdefault(r["shot_id"], []).append(r)
    return grouped


def set_cover_frame(db_path, shot_id, frame_id):
    """Mark one frame as the cover (clears the flag on all siblings)."""
    with _db(db_path) as conn:
        now = datetime.now().isoformat()
        conn.execute("UPDATE frames SET is_cover = 0 WHERE shot_id = ?", (shot_id,))
        conn.execute("UPDATE frames SET is_cover = 1, updated_at = ? WHERE id = ?",
                     (now, frame_id))
        _bump_rev(conn)
        conn.commit()
