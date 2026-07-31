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
    still_path  TEXT,
    thumb_path  TEXT,
    updated_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_shots_seq ON shots(seq);
"""


def init_db(db_path):
    """Initialize SQLite database with schema. Migrates legacy DBs (drops type column)."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(DB_SCHEMA)
    # Legacy migration: drop `type` column if present (SQLite >= 3.35)
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(shots)").fetchall()]
        if "type" in cols:
            conn.execute("ALTER TABLE shots DROP COLUMN type")
            print("[Storyboard] Migrated DB: dropped legacy 'type' column")
    except sqlite3.OperationalError:
        pass  # Very old SQLite without DROP COLUMN: harmless, column stays unread
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
        count, latest = conn.execute(
            "SELECT COUNT(*), COALESCE(MAX(updated_at), '') FROM shots"
        ).fetchone()
        conn.close()
        value = f"{count}-{latest}"
    except sqlite3.Error:
        value = "err"
    _version_cache[db_path] = (now, value)
    return value


def create_shot(db_path, name, scene_name, camera="", duration=2.0):
    """Create a new shot record. Returns shot id."""
    shot_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    conn = sqlite3.connect(db_path)
    # Get next seq
    cursor = conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM shots")
    seq = cursor.fetchone()[0]

    conn.execute(
        "INSERT INTO shots (id, seq, name, scene_name, camera, duration, notes, still_path, thumb_path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (shot_id, seq, name, scene_name, camera, duration, "", "", "", now)
    )
    conn.commit()
    conn.close()
    return shot_id


def update_shot(db_path, shot_id, **kwargs):
    """Update shot fields. Allowed: seq, name, scene_name, camera, duration, notes, still_path, thumb_path."""
    allowed = {"seq", "name", "scene_name", "camera", "duration", "notes", "still_path", "thumb_path"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return False

    updates["updated_at"] = datetime.now().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [shot_id]

    conn = sqlite3.connect(db_path)
    conn.execute(f"UPDATE shots SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return True


def delete_shot(db_path, shot_id):
    """Delete a shot record."""
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM shots WHERE id = ?", (shot_id,))
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


def get_all_shots(db_path):
    """Get all shots ordered by seq."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute("SELECT * FROM shots ORDER BY seq")
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


def reorder_shots(db_path, shot_ids):
    """Reorder shots by given id list. Updates seq for each."""
    conn = sqlite3.connect(db_path)
    for idx, shot_id in enumerate(shot_ids, start=1):
        conn.execute("UPDATE shots SET seq = ?, updated_at = ? WHERE id = ?",
                     (idx, datetime.now().isoformat(), shot_id))
    conn.commit()
    conn.close()
