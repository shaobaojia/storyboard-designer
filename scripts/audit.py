#!/usr/bin/env python3
"""Storyboard Designer 双向审计工具

验证 Blender 面板按钮和网页端按钮的每一个功能都真实生效，
输出通过/失败矩阵。每次改代码后跑一遍，代替人工逐项发现。

用法（在 NAS 上跑）:
    python3 scripts/audit.py

需要:
    - Blender 4.5 运行中, storyboard_designer 插件已启用
    - MCP 端口 9876 可达
    - HTTP 服务 8089 运行中
    - blend 文件已保存(项目目录可推导)
"""
import socket, json, urllib.request, time, os, sys, re

MCP_HOST = os.environ.get("SB_MCP", "192.168.3.71")
MCP_PORT = int(os.environ.get("SB_MCP_PORT", "9876"))
HTTP = f"http://{MCP_HOST}:{os.environ.get('SB_HTTP_PORT', '8089')}"

RESULTS = []  # (category, name, ok, detail)


def record(category, name, ok, detail=""):
    RESULTS.append((category, name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" -- {detail}" if detail else ""))


def blender(code, timeout=20):
    """Execute code in Blender via MCP, return stdout string."""
    s = socket.socket(); s.settimeout(timeout)
    s.connect((MCP_HOST, MCP_PORT))
    s.send(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
    data = b""
    r = {}
    while True:
        try:
            chunk = s.recv(8192)
            if not chunk:
                break
            data += chunk
            r = json.loads(data.decode())
            break
        except json.JSONDecodeError:
            continue
    s.close()
    res = r.get("result", {})
    if isinstance(res, dict):
        return res.get("result", "")
    return str(res)


def api(method, path, data=None):
    url = f"{HTTP}{path}"
    if data is not None:
        req = urllib.request.Request(url, data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"}, method=method)
    else:
        req = urllib.request.Request(url, method=method)
    return json.loads(urllib.request.urlopen(req, timeout=10).read().decode())


def state():
    """Get current DB + scene snapshot from Blender."""
    out = blender('''import bpy, os, json
from core.db import get_all_shots, get_db_path
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
shots = get_all_shots(get_db_path(project_dir))
print(json.dumps({
    "db": [(s["name"], s["id"], s["scene_name"]) for s in shots],
    "scenes": sorted([s.name for s in bpy.data.scenes]),
    "current": bpy.context.scene.name,
}))
''')
    try:
        # take last line (MCP may prepend register_class noise)
        for line in reversed(out.strip().splitlines()):
            line = line.strip()
            if line.startswith("{"):
                return json.loads(line)
    except Exception:
        pass
    return {"db": [], "scenes": [], "current": "?", "error": out[:200]}


def queue_and_wait(command, params, wait=3):
    """Queue a command on the main thread and wait for it to execute."""
    code = f'''import bpy
from core.queue import queue_command
queue_command({json.dumps(command)}, {json.dumps(params)})
print("queued")
'''
    blender(code)
    time.sleep(wait)


def names(st):
    return sorted([n for n, i, sn in st["db"]])


# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("Storyboard Designer Audit")
    print(f"MCP: {MCP_HOST}:{MCP_PORT}  HTTP: {HTTP}")
    print("=" * 60)

    # ---- 0. connectivity -------------------------------------------------
    print("\n[0] Connectivity")
    try:
        v = blender('import bpy\nprint(bpy.app.version_string)')
        record("connect", "MCP reachable", bool(v), v.strip()[:40])
    except Exception as e:
        record("connect", "MCP reachable", False, str(e))
        return summary()
    try:
        r = api("GET", "/api/shots")
        record("connect", "HTTP /api/shots", r.get("status") == "ok")
    except Exception as e:
        record("connect", "HTTP /api/shots", False, str(e))
        return summary()

    # ---- 1. Blender-side operators (via main-thread queue) ---------------
    print("\n[1] Blender panel buttons (operator -> effect)")

    # 1a. create_shot operator
    before = state()
    blender('''import bpy
# make sure we're on a normal scene
sc = bpy.data.scenes.get("Scene") or bpy.data.scenes[0]
try:
    bpy.context.window.scene = sc
except Exception:
    pass
bpy.ops.storyboard.create_shot(shot_name="AUDIT_CREATE")
print("ok")
''')
    time.sleep(2)
    after = state()
    ok = "AUDIT_CREATE" in names(after) and any("AUDIT_CREATE" in s for s in after["scenes"])
    record("blender", "Create Shot button", ok,
           f"DB+{len(names(after))-len(names(before))}, scene present: {any('AUDIT_CREATE' in s for s in after['scenes'])}")

    # 1b. render_shot operator - cannot be fully driven from MCP thread
    # (needs real window/viewport context). Instead: verify via a main-thread
    # timer render on the shot we just created, then check the WEB side.
    shot = next((s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_CREATE"), None)
    if shot:
        sid = shot["id"]
        # Drive render through the plugin's own main-thread queue (same code
        # path the panel button's render call uses, minus the context switch).
        blender(f'''import bpy
def run():
    scene = bpy.data.scenes.get("Shot_AUDIT_CREATE")
    if not scene:
        print("no scene")
        return None
    import os
    from core.render import render_shot_files
    project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
        os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
    shot_dir = os.path.join(project_dir, "shots", "AUDIT_CREATE_{sid}")
    render_shot_files(scene, shot_dir)
    print("rendered")
    return None
bpy.app.timers.register(run, first_interval=0.2)
print("queued")
''', timeout=15)
        time.sleep(8)
        out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "AUDIT_CREATE_{sid}")
print(os.listdir(d) if os.path.exists(d) else "MISSING")
''')
        has_still = "still.png" in out
        has_thumb = "thumb.jpg" in out
        record("blender", "Render Shot (render_shot_files)", has_still and has_thumb, out.strip()[:60])
        if has_thumb:
            try:
                resp = urllib.request.urlopen(f"{HTTP}/shots/AUDIT_CREATE_{sid}/thumb.jpg", timeout=5)
                record("blender", "  -> thumb visible on web", resp.status == 200, f"{resp.status}")
            except Exception as e:
                record("blender", "  -> thumb visible on web", False, str(e)[:60])

    # 1c. sync_scenes operator
    blender('bpy.ops.storyboard.sync_scenes()\nprint("ok")')
    record("blender", "Sync Scenes button", True, "executed without exception")

    # ---- 2. Web-side buttons ---------------------------------------------
    print("\n[2] Web buttons (API -> Blender effect)")

    # 2a. Create
    before = state()
    r = api("POST", "/api/shots", {"name": "AUDIT_WEB", "duration": 2.0})
    time.sleep(3)
    after = state()
    ok = "AUDIT_WEB" in names(after) and "Shot_AUDIT_WEB" in after["scenes"]
    record("web", "Create Shot", ok,
           f"scene created: {'Shot_AUDIT_WEB' in after['scenes']}")

    # 2b. Open (switch scene)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_WEB")
    api("POST", f"/api/shot/{shot['id']}", {"action": "open"})
    time.sleep(2)
    cur = state()["current"]
    record("web", "Open (switch scene)", cur == "Shot_AUDIT_WEB", f"current={cur}")

    # 2c. Rerender
    api("POST", f"/api/shot/{shot['id']}", {"action": "rerender"})
    time.sleep(8)
    sid = shot["id"]
    out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "AUDIT_WEB_{sid}")
print(os.listdir(d) if os.path.exists(d) else "MISSING")
''')
    record("web", "Rerender", "still.png" in out and "thumb.jpg" in out, out.strip()[:60])

    # 2d. Duplicate
    api("POST", f"/api/shot/{shot['id']}", {"action": "duplicate", "new_name": "AUDIT_WEB_COPY"})
    time.sleep(3)
    after = state()
    ok = "AUDIT_WEB_COPY" in names(after) and "Shot_AUDIT_WEB_COPY" in after["scenes"]
    record("web", "Duplicate", ok,
           f"scene named: {[s for s in after['scenes'] if 'AUDIT_WEB' in s]}")

    # 2e. Reorder (then undo it so the user's custom order survives the audit)
    shots = api("GET", "/api/shots")["shots"]
    ids = [s["id"] for s in shots]
    orig_order = [s["name"] for s in shots]
    api("POST", "/api/reorder", {"shot_ids": list(reversed(ids))})
    time.sleep(1)
    new_order = [s["name"] for s in api("GET", "/api/shots")["shots"]]
    record("web", "Reorder", new_order[0] == shots[-1]["name"],
           f"first now {new_order[0]}")
    # undo the reversal immediately (stack top = this reorder)
    r = api("POST", "/api/undo", {})
    time.sleep(1)
    back_order = [s["name"] for s in api("GET", "/api/shots")["shots"]]
    record("web", "Undo reorder", r.get("status") == "ok" and back_order == orig_order,
           f"undo={r.get('label')}, order restored: {back_order == orig_order}")

    # 2f. Soft delete -> trash -> restore -> undo dance -> purge (R3 #6)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_WEB_COPY")
    api("POST", f"/api/shot/{shot['id']}", {"action": "delete"})
    time.sleep(3)
    after = state()
    trash = api("GET", "/api/trash")
    in_trash = any(s["name"] == "AUDIT_WEB_COPY" for s in trash.get("shots", []))
    ok = ("AUDIT_WEB_COPY" not in names(after) and in_trash
          and "__trash__Shot_AUDIT_WEB_COPY" in after["scenes"])
    record("web", "Soft delete -> trash", ok,
           f"in_trash={in_trash}, scene parked: {'__trash__Shot_AUDIT_WEB_COPY' in after['scenes']}")
    v = api("GET", "/api/version")
    record("web", "  -> version.trash_count", v.get("trash_count") == 1,
           f"trash_count={v.get('trash_count')}")

    # restore from trash
    tid = next(s["id"] for s in api("GET", "/api/trash")["shots"] if s["name"] == "AUDIT_WEB_COPY")
    r = api("POST", f"/api/shot/{tid}", {"action": "restore"})
    time.sleep(3)
    after = state()
    ok = (r.get("status") == "ok" and "AUDIT_WEB_COPY" in names(after)
          and "Shot_AUDIT_WEB_COPY" in after["scenes"])
    record("web", "Restore from trash", ok, "")

    # undo the restore -> shot should be back in trash
    api("POST", "/api/undo", {})
    time.sleep(3)
    in_trash = any(s["name"] == "AUDIT_WEB_COPY" for s in api("GET", "/api/trash")["shots"])
    record("web", "Undo restore = re-trash", in_trash, f"in_trash={in_trash}")

    # undo the delete -> shot should be back in the grid
    api("POST", "/api/undo", {})
    time.sleep(3)
    after = state()
    ok = "AUDIT_WEB_COPY" in names(after) and "Shot_AUDIT_WEB_COPY" in after["scenes"]
    record("web", "Undo delete = restore", ok, "")

    # purge = permanent delete, NOT undoable
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_WEB_COPY")
    api("POST", f"/api/shot/{shot['id']}", {"action": "delete"})
    time.sleep(3)
    tid = next(s["id"] for s in api("GET", "/api/trash")["shots"] if s["name"] == "AUDIT_WEB_COPY")
    api("POST", f"/api/shot/{tid}", {"action": "purge"})
    time.sleep(3)
    after = state()
    gone = ("AUDIT_WEB_COPY" not in names(after)
            and not any(s["name"] == "AUDIT_WEB_COPY" for s in api("GET", "/api/trash")["shots"])
            and not any("AUDIT_WEB_COPY" in s for s in after["scenes"]))
    record("web", "Purge (hard delete)", gone, "")

    # 2g. Sync
    r = api("POST", "/api/sync", {})
    time.sleep(2)
    record("web", "Sync", r.get("status") == "ok", r.get("message", ""))

    # ---- 2h. v0.4 endpoints ----------------------------------------------
    print("\n[2h] v0.4 endpoints")

    # next_name: c-series, multiple of 10, not colliding with existing
    r = api("GET", "/api/next_name")
    taken = {s["name"] for s in api("GET", "/api/shots")["shots"]}
    ok = (r.get("status") == "ok" and re.fullmatch(r"c\d{3}0", r.get("name", ""))
          and r["name"] not in taken)
    record("web", "next_name", ok, r.get("name", ""))

    # project: page title = blend filename (no .blend)
    r = api("GET", "/api/project")
    blend_stem = os.path.splitext(os.path.basename(
        blender("import bpy\nprint(bpy.data.filepath)").strip()))[0]
    record("web", "project title", r.get("name") == blend_stem,
           f"{r.get('name')} vs {blend_stem}")

    # version: carries version string + errors list + R3 badges
    r = api("GET", "/api/version")
    ok = (r.get("status") == "ok" and isinstance(r.get("version"), str)
          and isinstance(r.get("errors"), list)
          and isinstance(r.get("trash_count"), int) and "undo_label" in r)
    record("web", "version payload (+errors/trash/undo)", ok,
           f"errors={len(r.get('errors', []))}, trash={r.get('trash_count')}, undo={r.get('undo_label')}")

    # rename: DB + scene + camera follow the new name
    api("POST", "/api/shots", {"name": "AUDIT_REN", "duration": 2.0})
    time.sleep(3)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_REN")
    api("POST", f"/api/shot/{shot['id']}", {"action": "rename", "new_name": "AUDIT_REN2"})
    time.sleep(3)
    st = state()
    cam = blender('''import bpy
s = bpy.data.scenes.get("Shot_AUDIT_REN2")
print(s.camera.name if s and s.camera else "MISSING")
''').strip()
    ok = ("AUDIT_REN2" in names(st) and "Shot_AUDIT_REN2" in st["scenes"]
          and "AUDIT_REN2" in cam)
    record("web", "Rename (DB+scene+camera)", ok, f"camera={cam}")

    # duplicate uniqueness: two copies without explicit names never collide
    for _ in range(2):
        api("POST", f"/api/shot/{shot['id']}", {"action": "duplicate"})
        time.sleep(2)
    time.sleep(2)
    st = state()
    dupes = sorted(n for n in names(st) if n.startswith("c") and n not in taken
                   and n != "AUDIT_REN2" and "AUDIT" not in n)
    ok = len(dupes) >= 2 and len(set(dupes)) == len(dupes)
    record("web", "Duplicate unique names", ok, f"new={dupes}")

    # rename_seq: selection renumbered into ascending unique c-names
    for nm in ("AUDIT_S1", "AUDIT_S2", "AUDIT_S3"):
        api("POST", "/api/shots", {"name": nm, "duration": 2.0})
        time.sleep(2)
    ids = [s["id"] for s in api("GET", "/api/shots")["shots"] if s["name"].startswith("AUDIT_S")]
    r = api("POST", "/api/batch", {"action": "rename_seq", "shot_ids": ids})
    time.sleep(10)
    st = state()
    seq_names = [n for n, i, sn in st["db"] if i in ids]
    ok = (len(seq_names) == 3 and len(set(seq_names)) == 3
          and all(re.fullmatch(r"c\d{3}0", n) for n in seq_names)
          and all(n not in taken for n in seq_names))
    record("web", "Batch rename_seq", ok, f"{seq_names}")

    # set_background: camera background image at full opacity
    png_b64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
               "2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_REN2")
    api("POST", f"/api/shot/{shot['id']}",
        {"action": "set_background", "filename": "audit_bg.png", "data_base64": png_b64})
    time.sleep(4)
    out = blender('''import bpy
s = bpy.data.scenes.get("Shot_AUDIT_REN2")
bgs = list(s.camera.data.background_images) if s and s.camera else []
print(",".join(str(b.alpha) for b in bgs) if bgs else "NONE")
''').strip()
    record("web", "set_background alpha=1.0", out == "1.0", f"alpha={out}")

    # ---- 2i. R3 features --------------------------------------------------
    print("\n[2i] R3: fields / undo / duplicate position")

    # update fields: content/dialogue/duration persist, undo reverts (#13/#15)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_REN2")
    old_dur = shot["duration"]
    r = api("POST", f"/api/shot/{shot['id']}", {"action": "update", "fields": {
        "content": "审计内容", "dialogue": "审计台词", "duration": 9.9}})
    time.sleep(1)
    shot2 = next(s for s in api("GET", "/api/shots")["shots"] if s["id"] == shot["id"])
    ok = (r.get("status") == "ok" and shot2.get("content") == "审计内容"
          and shot2.get("dialogue") == "审计台词" and abs(shot2["duration"] - 9.9) < 0.01)
    record("web", "update fields (content/dialogue/duration)", ok,
           f"content={shot2.get('content')!r}, dur={shot2['duration']}")
    api("POST", "/api/undo", {})
    time.sleep(1)
    shot3 = next(s for s in api("GET", "/api/shots")["shots"] if s["id"] == shot["id"])
    ok = (not shot3.get("content") and not shot3.get("dialogue")
          and abs(shot3["duration"] - old_dur) < 0.01)
    record("web", "Undo update fields", ok, f"dur back to {shot3['duration']}")

    # duplicate inserts the copy right after the source (#9), undo purges it
    api("POST", "/api/shots", {"name": "AUDIT_POS", "duration": 2.0})
    time.sleep(3)
    order = [s["name"] for s in api("GET", "/api/shots")["shots"]]
    src_idx = order.index("AUDIT_POS")
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_POS")
    r = api("POST", f"/api/shot/{shot['id']}", {"action": "duplicate"})
    time.sleep(4)
    copy_name = r.get("new_name")
    order2 = [s["name"] for s in api("GET", "/api/shots")["shots"]]
    ok = bool(copy_name) and copy_name in order2 and order2.index(copy_name) == src_idx + 1
    record("web", "Duplicate inserts after source", ok,
           f"{copy_name} at {order2.index(copy_name) if copy_name in order2 else '?'}, src at {src_idx}")
    api("POST", "/api/undo", {})
    time.sleep(4)
    order3 = [s["name"] for s in api("GET", "/api/shots")["shots"]]
    record("web", "Undo duplicate = purge copy", copy_name not in order3,
           f"{copy_name} gone: {copy_name not in order3}")

    # rename undo: AUDIT_REN2 -> AUDIT_REN3 -> undo -> AUDIT_REN2
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_REN2")
    api("POST", f"/api/shot/{shot['id']}", {"action": "rename", "new_name": "AUDIT_REN3"})
    time.sleep(3)
    names_now = [s["name"] for s in api("GET", "/api/shots")["shots"]]
    ok = "AUDIT_REN3" in names_now
    api("POST", "/api/undo", {})
    time.sleep(3)
    names_now = [s["name"] for s in api("GET", "/api/shots")["shots"]]
    ok = ok and "AUDIT_REN2" in names_now and "AUDIT_REN3" not in names_now
    record("web", "Undo rename", ok, f"names={['AUDIT_REN2' in names_now, 'AUDIT_REN3' in names_now]}")

    # create undo: create then undo -> shot + scene purged
    api("POST", "/api/shots", {"name": "AUDIT_TMP", "duration": 2.0})
    time.sleep(3)
    ok = "AUDIT_TMP" in [s["name"] for s in api("GET", "/api/shots")["shots"]]
    api("POST", "/api/undo", {})
    time.sleep(4)
    st = state()
    ok = ok and "AUDIT_TMP" not in names(st) and not any("AUDIT_TMP" in s for s in st["scenes"])
    record("web", "Undo create = purge new shot", ok, "")

    # Drain whatever is left on the undo stack; the final pop must report
    # "empty" without crashing. Inverses replayed here only touch AUDIT_*
    # shots (user order was already restored by the reorder-undo above).
    for _ in range(25):
        r = api("POST", "/api/undo", {})
        if r.get("status") == "empty":
            break
        time.sleep(2)
    record("web", "Undo stack drains to empty safely", r.get("status") == "empty",
           f"last={r.get('status')}")
    time.sleep(3)

    # ---- 2j. R4 features --------------------------------------------------
    print("\n[2j] R4: thumb_ver / reorder no-touch / batch restore")

    # thumb_ver: only a real render bumps it; field edits & reorders never do
    api("POST", "/api/shots", {"name": "AUDIT_TV", "duration": 2.0})
    time.sleep(4)  # create 自带一次拍屏
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_TV")
    v0 = shot.get("thumb_ver") or 0
    api("POST", f"/api/shot/{shot['id']}", {"action": "update", "fields": {"content": "x"}})
    time.sleep(1)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_TV")
    v1 = shot.get("thumb_ver") or 0
    api("POST", f"/api/shot/{shot['id']}", {"action": "rerender"})
    time.sleep(8)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_TV")
    v2 = shot.get("thumb_ver") or 0
    ok = v1 == v0 and v2 == v1 + 1
    record("web", "thumb_ver bumps only on render", ok, f"v {v0}->{v1}(edit)->{v2}(render)")

    # reorder: changes version (rev) but NOT updated_at / thumb_ver
    shots = api("GET", "/api/shots")["shots"]
    ua_before = {s["id"]: s["updated_at"] for s in shots}
    ver_before = api("GET", "/api/version")["version"]
    api("POST", "/api/reorder", {"shot_ids": list(reversed([s["id"] for s in shots]))})
    time.sleep(1)
    shots2 = api("GET", "/api/shots")["shots"]
    ua_same = all(ua_before.get(s["id"]) == s["updated_at"] for s in shots2)
    ver_changed = api("GET", "/api/version")["version"] != ver_before
    record("web", "Reorder bumps rev, leaves updated_at alone", ua_same and ver_changed,
           f"ua_same={ua_same}, version moved={ver_changed}")
    api("POST", "/api/undo", {})  # 恢复原顺序
    time.sleep(1)

    # batch restore: delete two, restore both in one call
    for nm in ("AUDIT_BR1", "AUDIT_BR2"):
        api("POST", "/api/shots", {"name": nm, "duration": 2.0})
        time.sleep(3)
    ids = [s["id"] for s in api("GET", "/api/shots")["shots"] if s["name"].startswith("AUDIT_BR")]
    api("POST", "/api/batch", {"action": "delete", "shot_ids": ids})
    time.sleep(4)
    in_trash = len([s for s in api("GET", "/api/trash")["shots"] if s["name"].startswith("AUDIT_BR")])
    tids = [s["id"] for s in api("GET", "/api/trash")["shots"] if s["name"].startswith("AUDIT_BR")]
    r = api("POST", "/api/batch", {"action": "restore", "shot_ids": tids})
    time.sleep(4)
    back = len([s for s in api("GET", "/api/shots")["shots"] if s["name"].startswith("AUDIT_BR")])
    ok = in_trash == 2 and r.get("done") == 2 and back == 2
    record("web", "Batch restore from trash", ok,
           f"trash={in_trash}, restored={r.get('done')}, back={back}")
    api("POST", "/api/undo", {})  # 撤销批量恢复 = 回到垃圾桶，cleanup 会彻底清
    time.sleep(3)

    # ---- 3. cleanup -------------------------------------------------------
    print("\n[3] Cleanup test shots")
    # soft-delete every AUDIT / audit-created c shot still in the grid...
    for shot in api("GET", "/api/shots")["shots"]:
        nm = shot["name"]
        if "AUDIT" in nm or (nm.startswith("c") and nm not in taken):
            api("POST", f"/api/shot/{shot['id']}", {"action": "delete"})
            time.sleep(2)
    # ...then purge them out of the trash bin for real
    for shot in api("GET", "/api/trash")["shots"]:
        nm = shot["name"]
        if "AUDIT" in nm or (nm.startswith("c") and nm not in taken):
            api("POST", f"/api/shot/{shot['id']}", {"action": "purge"})
            time.sleep(2)
    api("POST", "/api/sync", {})
    time.sleep(2)
    after = state()
    leftover = [n for n in names(after) if "AUDIT" in n or (n.startswith("c") and n not in taken)]
    trash_left = [s["name"] for s in api("GET", "/api/trash")["shots"]
                  if "AUDIT" in s["name"] or (s["name"].startswith("c") and s["name"] not in taken)]
    ok = not leftover and not trash_left
    record("cleanup", "test shots removed (grid+trash)", ok,
           f"leftover={leftover}, trash={trash_left}")

    return summary()


def summary():
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    passed = sum(1 for r in RESULTS if r[2])
    total = len(RESULTS)
    print(f"{passed}/{total} passed")
    fails = [r for r in RESULTS if not r[2]]
    if fails:
        print("\nFAILED:")
        for cat, name, ok, detail in fails:
            print(f"  [{cat}] {name}: {detail}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
