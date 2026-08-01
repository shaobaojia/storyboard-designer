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
    updated_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_shots_seq ON shots(seq);

CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v INTEGER
);
"""


def _bump_rev(conn):
    """Every mutation bumps the global revision counter (meta.rev).

    get_db_version reads it — one integer that changes on ANY write
    (including reorders, which no longer touch updated_at)."""
    conn.execute(
        "INSERT INTO meta (k, v) VALUES ('rev', 1) "
        "ON CONFLICT(k) DO UPDATE SET v = v + 1")


def init_db(db_path):
    """Initialize SQLite database with schema. Migrates legacy DBs."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(DB_SCHEMA)
    # Legacy migration: drop `type` column if present (SQLite >= 3.35)
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(shots)").fetchall()]
        if "type" in cols:
            conn.execute("ALTER TABLE shots DROP COLUMN type")
            print("[Storyboard] Migrated DB: dropped legacy 'type' column")
        for col, ddl in (("content", "TEXT DEFAULT ''"),
                         ("dialogue", "TEXT DEFAULT ''"),
                         ("deleted", "INTEGER DEFAULT 0"),
                         ("thumb_ver", "INTEGER DEFAULT 0")):
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


def create_shot(db_path, name, scene_name, camera="", duration=2.0, shot_id=None):
    """Create a new shot record. Returns shot id (pre-generatable for undo wiring)."""
    shot_id = shot_id or str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    conn = sqlite3.connect(db_path)
    # Get next seq
    cursor = conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM shots")
    seq = cursor.fetchone()[0]

    conn.execute(
        "INSERT INTO shots (id, seq, name, scene_name, camera, duration, notes, still_path, thumb_path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (shot_id, seq, name, scene_name, camera, duration, "", "", "", now)
    )
    _bump_rev(conn)
    conn.commit()
    conn.close()
    return shot_id


def update_shot(db_path, shot_id, **kwargs):
    """Update shot fields. Allowed: seq, name, scene_name, camera, duration, notes, content, dialogue, deleted, still_path, thumb_path.

    Setting a non-empty thumb_path means a fresh render landed — thumb_ver
    auto-increments so the web side refreshes exactly that one image.
    Anything else (rename/reorder/text edits) leaves thumb_ver alone."""
    allowed = {"seq", "name", "scene_name", "camera", "duration", "notes",
               "content", "dialogue", "deleted", "still_path", "thumb_path"}
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

    conn = sqlite3.connect(db_path)
    conn.execute(f"UPDATE shots SET {set_clause} WHERE id = ?", values)
    _bump_rev(conn)
    conn.commit()
    conn.close()
    return True


def delete_shot(db_path, shot_id):
    """Delete a shot record."""
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM shots WHERE id = ?", (shot_id,))
    _bump_rev(conn)
    conn.commit()
    conn.close()


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
    conn = sqlite3.connect(db_path)
    for idx, shot_id in enumerate(shot_ids, start=1):
        conn.execute("UPDATE shots SET seq = ? WHERE id = ?", (idx, shot_id))
    _bump_rev(conn)
    conn.commit()
    conn.close()
