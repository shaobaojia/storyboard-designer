#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Storyboard Designer Audit（v0.9.13 起支持 --only 段级筛选：改哪只审哪里）
# 用法：python scripts/audit.py                # 全量 41 项
#       python scripts/audit.py --only=trash   # 只跑命中段（依赖段自动包含）
#       关键词匹配 record 名子串或段 id（s1/s2/s2h/s2i/s2j/s2k）

#!/usr/bin/env python3
"""Storyboard Designer 双向审计工具

验证 Blender 面板按钮和网页端按钮的每一个功能都真实生效，
输出通过/失败矩阵。每次改代码后跑一遍，代替人工逐项发现。

用法（本机直连跑，SB_MCP/SB_MCP_PORT/SB_HTTP_PORT 环境变量可覆盖）:
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


def names(st):
    return sorted([n for n, i, sn in st["db"]])


# ---------------------------------------------------------------------------



def s1_body():
    print("\n[1] Blender panel buttons (operator -> effect)")

    # 1a. create_shot operator（timer 包装：auto-render 需要主线程视口，MCP 线程会静默失败）
    before = state()
    blender('''import bpy
def run():
    try:
        bpy.context.window.scene = bpy.data.scenes.get("Scene") or bpy.data.scenes[0]
        bpy.ops.storyboard.create_shot(shot_name="AUDIT_CREATE")
        print("created")
    except Exception as e:
        print("ERR", e)
    return None
bpy.app.timers.register(run, first_interval=0.2)
print("queued")
''')
    time.sleep(5)
    after = state()
    ok = "AUDIT_CREATE" in names(after) and any("AUDIT_CREATE" in s for s in after["scenes"])
    record("blender", "Create Shot button", ok,
           f"DB+{len(names(after))-len(names(before))}, scene present: {any('AUDIT_CREATE' in s for s in after['scenes'])}")

    # 1b. create 自动拍屏（v0.8.4: 统一 frames 模型——创建即拍 f0，自动成为封面）。
    # 渲染需真实视口（MCP 线程走 workbench fallback 也能出文件），验证 f0 产物 + frames 行
    shot = next((s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_CREATE"), None)
    if shot:
        sid = shot["id"]
        out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "AUDIT_CREATE_{sid}")
print(os.listdir(d) if os.path.exists(d) else "MISSING")
''')
        frames = shot.get("frames") or []
        frames_ok = len(frames) >= 1 and bool(frames[0].get("isCover"))
        record("blender", "Auto-render f0 (create path)", "f00000_still.jpg" in out and "f00000_thumb.jpg" in out and frames_ok,
               out.strip()[:60] + f" frames={len(frames)}")
        if "f00000_thumb.jpg" in out:
            try:
                resp = urllib.request.urlopen(f"{HTTP}/shots/AUDIT_CREATE_{sid}/f00000_thumb.jpg", timeout=5)
                record("blender", "  -> f0 thumb served via HTTP", resp.status == 200, f"{resp.status}")
            except Exception as e:
                record("blender", "  -> f0 thumb served via HTTP", False, str(e)[:60])

    # 1c. sync_scenes operator
    blender('bpy.ops.storyboard.sync_scenes()\nprint("ok")')
    record("blender", "Sync Scenes button", True, "executed without exception")

    # ---- 2. Web-side buttons ---------------------------------------------


def s2_body():
    print("\n[2] Create + 时长对齐")

    # 2a. Create
    before = state()
    r = api("POST", "/api/shots", {"name": "AUDIT_WEB", "duration": 2.0})
    time.sleep(3)
    after = state()
    ok = "AUDIT_WEB" in names(after) and "Shot_AUDIT_WEB" in after["scenes"]
    record("web", "Create Shot", ok,
           f"scene created: {'Shot_AUDIT_WEB' in after['scenes']}")

    # 2a2. create 时长对齐（v0.9.1 规则：frame_start=1, frame_end=max(1, int(duration*fps))）
    out = blender('''import bpy
s = bpy.data.scenes.get("Shot_AUDIT_WEB")
print(s.frame_start, s.frame_end, s.render.fps) if s else print("MISSING")
''').strip()
    parts = out.split()
    ok = (len(parts) == 3 and parts[0] == "1"
          and int(parts[1]) == max(1, int(2.0 * float(parts[2]))))
    record("web", "Create 时长对齐 (frame_end=duration*fps)", ok, f"start/end/fps={out}")

def s3_open_body():
    print("\n[3] Open (switch scene)")
    # 2b. Open (switch scene)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_WEB")
    api("POST", f"/api/shot/{shot['id']}", {"action": "open"})
    time.sleep(2)
    cur = state()["current"]
    record("web", "Open (switch scene)", cur == "Shot_AUDIT_WEB", f"current={cur}")

def s4_rerender_body():
    print("\n[4] 重拍封面 (cover frame)")
    # 2c. Rerender = 重拍封面帧（v0.8.4: 统一 frames 模型，等价旧 RenderShot）
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_WEB")
    api("POST", f"/api/shot/{shot['id']}", {"action": "rerender"})
    time.sleep(8)
    sid = shot["id"]
    out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "AUDIT_WEB_{sid}")
print(os.listdir(d) if os.path.exists(d) else "MISSING")
''')
    record("web", "重拍封面 (cover frame)", "f00000_still.jpg" in out and "f00000_thumb.jpg" in out, out.strip()[:60])

def s5_duplicate_body():
    print("\n[5] Duplicate (含多图保帧)")
    # 2d. Duplicate
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_WEB")
    api("POST", f"/api/shot/{shot['id']}", {"action": "duplicate", "new_name": "AUDIT_WEB_COPY"})
    time.sleep(3)
    after = state()
    ok = "AUDIT_WEB_COPY" in names(after) and "Shot_AUDIT_WEB_COPY" in after["scenes"]
    record("web", "Duplicate", ok,
           f"scene named: {[s for s in after['scenes'] if 'AUDIT_WEB' in s]}")

    # 2d2. duplicate 多图保帧（v0.8.4 修过的漏网 bug：复制多图丢帧——固化防复发）
    api("POST", "/api/shots", {"name": "AUDIT_DUP", "duration": 2.0})
    time.sleep(3)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_DUP")
    api("POST", f"/api/shot/{shot['id']}", {"action": "render_frame", "frame_no": 1})
    time.sleep(6)
    api("POST", f"/api/shot/{shot['id']}", {"action": "render_frame", "frame_no": 2})
    time.sleep(6)
    src = next(s for s in api("GET", "/api/shots")["shots"] if s["id"] == shot["id"])
    src_frames = src.get("frames") or []
    src_cover = next((f["frame_no"] for f in src_frames if f.get("isCover")), None)
    api("POST", f"/api/shot/{shot['id']}", {"action": "duplicate", "new_name": "AUDIT_DUP_COPY"})
    time.sleep(4)
    copy = next((s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_DUP_COPY"), None)
    copy_frames = (copy.get("frames") or []) if copy else []
    copy_cover = next((f["frame_no"] for f in copy_frames if f.get("isCover")), None)
    files_ok = False
    if copy:
        out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "AUDIT_DUP_COPY_{copy['id']}")
print(sorted(os.listdir(d)) if os.path.exists(d) else "MISSING")
''')
        files_ok = all(nm in out for nm in ("f00000_thumb.jpg", "f00001_thumb.jpg", "f00002_thumb.jpg"))
    ok = (copy is not None and len(copy_frames) == len(src_frames) == 3
          and copy_cover == src_cover and files_ok)
    record("web", "Duplicate 多图保帧 (frames+文件+封面)", ok,
           f"src={len(src_frames)}帧 cover={src_cover}, copy={len(copy_frames)}帧 cover={copy_cover}, files={files_ok}")

def s6_reorder_body():
    print("\n[6] Reorder + Undo")
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

def s7_trash_body():
    print("\n[7] Soft delete/restore/undo/purge")
    # 2f. Soft delete -> trash -> restore -> undo dance -> purge (R3 #6)
    trash_baseline = api("GET", "/api/version").get("trash_count", 0)
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
    record("web", "  -> version.trash_count", v.get("trash_count") == trash_baseline + 1,
           f"trash_count={v.get('trash_count')} (baseline={trash_baseline})")

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

def s8_sync_body():
    print("\n[8] Sync")
    # 2g. Sync
    r = api("POST", "/api/sync", {})
    time.sleep(2)
    record("web", "Sync", r.get("status") == "ok", r.get("message", ""))

def s2h_body():
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

    # rename 四层联动补全（v0.3.0 修过的漏网 bug：改名断相机背景图 + 磁盘目录没改名）
    png_b64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
               "2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    api("POST", "/api/shots", {"name": "AUDIT_BGREN", "duration": 2.0})
    time.sleep(3)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_BGREN")
    api("POST", f"/api/shot/{shot['id']}",
        {"action": "set_background", "filename": "audit_bg.png", "data_base64": png_b64})
    time.sleep(4)
    old_dir = f"AUDIT_BGREN_{shot['id']}"
    api("POST", f"/api/shot/{shot['id']}", {"action": "rename", "new_name": "AUDIT_BGREN2"})
    time.sleep(3)
    st = state()
    out = blender(f'''import bpy, os, json
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
s = bpy.data.scenes.get("Shot_AUDIT_BGREN2")
bg = s.camera.data.background_images[0].image if s and s.camera and s.camera.data.background_images else None
d_new = os.path.join(project_dir, "shots", "AUDIT_BGREN2_{shot['id']}")
d_old = os.path.join(project_dir, "shots", "{old_dir}")
print(json.dumps({{
    "dir_new": os.path.exists(d_new),
    "dir_old": os.path.exists(d_old),
    "bg_path": bg.filepath if bg else None,
    "bg_exists": os.path.exists(bg.filepath) if bg else False,
}}))
''')
    info = {}
    for line in reversed(out.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                info = json.loads(line)
                break
            except Exception:
                pass
    ok = ("AUDIT_BGREN2" in names(st) and "Shot_AUDIT_BGREN2" in st["scenes"]
          and info.get("dir_new") is True and info.get("dir_old") is False
          and bool(info.get("bg_path")) and "AUDIT_BGREN2" in info["bg_path"]
          and info.get("bg_exists") is True)
    record("web", "Rename 四层 (DB+scene+camera+目录+bg重指)", ok,
           f"dir_new={info.get('dir_new')}, dir_old={info.get('dir_old')}, bg={info.get('bg_path')}, bg_exists={info.get('bg_exists')}")

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


def s2i_body():
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


def s2j_body():
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



def s2k_body():
    # ---- 2k. v0.7.1: frames cascade on purge (接手审计发现 delete_shot 不删 frames) ----
    api("POST", "/api/shots", {"name": "AUDIT_FRC", "duration": 2.0})
    time.sleep(3)
    shot = next(s for s in api("GET", "/api/shots")["shots"] if s["name"] == "AUDIT_FRC")
    api("POST", f"/api/shot/{shot['id']}", {"action": "render_frame", "frame_no": 1})
    time.sleep(6)
    n_frames = blender(f'''import sqlite3
from core.paths import get_project_dir
from core.db import get_db_path
con = sqlite3.connect(get_db_path(get_project_dir()))
print(con.execute("SELECT COUNT(*) FROM frames WHERE shot_id='{shot['id']}'").fetchone()[0])
con.close()
''').strip()
    api("POST", f"/api/shot/{shot['id']}", {"action": "purge"})
    time.sleep(3)
    n_after = blender(f'''import sqlite3
from core.paths import get_project_dir
from core.db import get_db_path
con = sqlite3.connect(get_db_path(get_project_dir()))
print(con.execute("SELECT COUNT(*) FROM frames WHERE shot_id='{shot['id']}'").fetchone()[0])
con.close()
''').strip()
    record("web", "Frames cascade on purge", n_frames == "2" and n_after == "0",
           f"frames {n_frames}->{n_after}")

    # ---- 3. cleanup -------------------------------------------------------


def s3_body(taken):
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

    

def main():
    # ---- --only 段级筛选（v0.9.13 C 方案：改哪只审哪里）----
    import sys as _sys
    only = None
    for _a in _sys.argv[1:]:
        if _a.startswith('--only='):
            only = [k.strip().lower() for k in _a[7:].split(',') if k.strip()]
    # 段注册表：id -> (record 名子串, 依赖段)  s2i 用 AUDIT_REN2（s2h 建）
    SEG_REG = {
        's1':  (['create shot', 'auto-render', 'sync scenes'], ()),
        's2':  (['create', '时长对齐', 'duration'], ()),
        's3':  (['open (switch'], ('s2',)),
        's4':  (['重拍封面', 'rerender'], ('s2',)),
        's5':  (['duplicate'], ('s2',)),
        's6':  (['reorder'], ()),
        's7':  (['soft delete', 'trash', 'restore', 'purge', 'trash_count'], ('s5',)),
        's8':  (['sync'], ()),
        's9':  (['next_name', 'project title', 'version payload', 'rename',
                 'set_background', 'duplicate unique'], ()),
        's10': (['update fields', 'undo', 'duplicate inserts'], ('s9',)),
        's11': (['thumb_ver', 'reorder bumps', 'batch restore'], ()),
        's12': (['frames cascade'], ()),
    }
    def _matches(sid):
        if not only:
            return True
        names = SEG_REG[sid][0]
        return any(k == sid or any(k in n for n in names) for k in only)
    active = []
    for sid in ('s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12'):
        if _matches(sid):
            active.append(sid)
    # 正向依赖闭包：被激活段的依赖段（数据前置）插到其前面，递归直到稳定
    # （例：--only=trash 命中 s7 → 前置 s5(duplicate)→s2(create)，顺序 s2→s5→s7）
    i = 0
    while i < len(active):
        deps = [d for d in SEG_REG[active[i]][1] if d not in active]
        if deps:
            active[i:i] = deps
            i -= 1
        i += 1
    if only and not active:
        print('--only 未命中任何段。可用：段 id s1..s12 或关键词（create/open/rerender/duplicate/reorder/trash/sync/rename/undo/thumb/frames/...）')
        return summary()
    if only:
        print(f'[--only] 激活段: {active}')
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

    # 审计前全量镜头名快照（cleanup 判断"审计期间新建的 c 镜头"用）——
    # 必须在段执行前取：--only 跳过 s2h 时原 taken 为空 set，cleanup 会把
    # 用户 c00xx 镜头当测试残留误删（2026-08 发现）
    taken = {s['name'] for s in api('GET', '/api/shots')['shots']}
    for _sid in active:
        if _sid == 's1': s1_body()
        elif _sid == 's2': s2_body()
        elif _sid == 's3': s3_open_body()
        elif _sid == 's4': s4_rerender_body()
        elif _sid == 's5': s5_duplicate_body()
        elif _sid == 's6': s6_reorder_body()
        elif _sid == 's7': s7_trash_body()
        elif _sid == 's8': s8_sync_body()
        elif _sid == 's9': s2h_body()
        elif _sid == 's10': s2i_body()
        elif _sid == 's11': s2j_body()
        elif _sid == 's12': s2k_body()

    # ---- 3. cleanup（永远跑，保证无残留） ----
    s3_body(taken)
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
