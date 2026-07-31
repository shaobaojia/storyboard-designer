#!/usr/bin/env python3
"""右键菜单专项审计

逐项验证网页端右键菜单的 4 个功能（Open/Re-render/Duplicate/Delete）
都真实作用到 Blender 端。与 scripts/audit.py 的区别：专注右键菜单
路径（/api/shot/{id} 的 4 个 action），用真实 shot 而非一次性 AUDIT shot。

用法: python3 scripts/audit_context_menu.py
"""
import socket, json, urllib.request, time, os, sys

MCP_HOST = os.environ.get("SB_MCP", "192.168.3.71")
MCP_PORT = int(os.environ.get("SB_MCP_PORT", "9876"))
HTTP = f"http://{MCP_HOST}:8089"

RESULTS = []

def record(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))

def blender(code, timeout=20):
    s = socket.socket(); s.settimeout(timeout)
    s.connect((MCP_HOST, MCP_PORT))
    s.send(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
    data = b""; r = {}
    while True:
        try:
            chunk = s.recv(8192)
            if not chunk: break
            data += chunk
            r = json.loads(data.decode()); break
        except json.JSONDecodeError: continue
    s.close()
    res = r.get("result", {})
    return res.get("result", "") if isinstance(res, dict) else str(res)

def api(method, path, data=None):
    url = f"{HTTP}{path}"
    if data is not None:
        req = urllib.request.Request(url, data=json.dumps(data).encode(),
            headers={'Content-Type': 'application/json'}, method=method)
    else:
        req = urllib.request.Request(url, method=method)
    return json.loads(urllib.request.urlopen(req, timeout=10).read().decode())

def state():
    out = blender('''import bpy, os, json
from core.db import get_all_shots, get_db_path
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
shots = get_all_shots(get_db_path(project_dir))
print(json.dumps({
    "db": [s["name"] for s in shots],
    "scenes": sorted([s.name for s in bpy.data.scenes]),
    "current": bpy.context.scene.name,
}))
''')
    for line in reversed(out.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            return json.loads(line)
    return {"db": [], "scenes": [], "current": "?"}


def main():
    print("=" * 56)
    print("右键菜单专项审计 (Open / Re-render / Duplicate / Delete)")
    print("=" * 56)

    # connectivity
    try:
        blender('import bpy\nprint(1)')
        api("GET", "/api/shots")
    except Exception as e:
        print(f"FATAL: connectivity -- {e}")
        return 1

    # Create a dedicated test shot via API so we have a known entity
    print("\n[setup] create CTX_TEST shot")
    r = api("POST", "/api/shots", {"name": "CTX_TEST", "duration": 2.0, "type": "3d"})
    tid = r["id"]
    time.sleep(3)
    st = state()
    print(f"  DB: {st['db']}, scene present: {'Shot_CTX_TEST' in st['scenes']}")

    # ---- 1. Open Shot (right-click -> Open Shot) ----
    print("\n[1] right-click Open Shot")
    api("POST", f"/api/shot/{tid}", {"action": "open"})
    time.sleep(2)
    cur = state()["current"]
    record("Open Shot -> Blender 切换到该场景", cur == "Shot_CTX_TEST", f"current={cur}")

    # ---- 2. Re-render (right-click -> Re-render) ----
    print("\n[2] right-click Re-render")
    api("POST", f"/api/shot/{tid}", {"action": "rerender"})
    time.sleep(8)
    out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "CTX_TEST_{tid}")
print(os.listdir(d) if os.path.exists(d) else "MISSING")
''')
    ok = "still.png" in out and "thumb.jpg" in out
    record("Re-render -> still+thumb 落盘", ok, out.strip()[:60])
    try:
        resp = urllib.request.urlopen(f"{HTTP}/shots/CTX_TEST_{tid}/thumb.jpg", timeout=5)
        record("Re-render -> 缩略图网页可见", resp.status == 200, f"{resp.status}")
    except Exception as e:
        record("Re-render -> 缩略图网页可见", False, str(e)[:60])

    # ---- 3. Duplicate (right-click -> Duplicate) ----
    print("\n[3] right-click Duplicate")
    api("POST", f"/api/shot/{tid}", {"action": "duplicate", "new_name": "CTX_TEST_COPY"})
    time.sleep(3)
    st = state()
    db_ok = "CTX_TEST_COPY" in st["db"]
    sc_ok = "Shot_CTX_TEST_COPY" in st["scenes"]
    record("Duplicate -> DB 新增记录", db_ok, f"DB={st['db']}")
    record("Duplicate -> Blender 新建场景", sc_ok,
           f"scenes={[s for s in st['scenes'] if 'CTX' in s]}")

    # ---- 4. Delete (right-click -> Delete) ----
    print("\n[4] right-click Delete")
    # delete the copy first
    shots = api("GET", "/api/shots")["shots"]
    copy_shot = next((s for s in shots if s["name"] == "CTX_TEST_COPY"), None)
    if copy_shot:
        api("POST", f"/api/shot/{copy_shot['id']}", {"action": "delete"})
        time.sleep(3)
        st = state()
        record("Delete(copy) -> DB 记录删除", "CTX_TEST_COPY" not in st["db"])
        record("Delete(copy) -> Blender 场景删除", "Shot_CTX_TEST_COPY" not in st["scenes"])
    # delete the original test shot
    api("POST", f"/api/shot/{tid}", {"action": "delete"})
    time.sleep(3)
    st = state()
    record("Delete(orig) -> DB 记录删除", "CTX_TEST" not in st["db"])
    record("Delete(orig) -> Blender 场景删除", "Shot_CTX_TEST" not in st["scenes"])
    # files cleaned?
    out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "CTX_TEST_{tid}")
print("EXISTS" if os.path.exists(d) else "GONE")
''')
    record("Delete(orig) -> 磁盘目录清理", "GONE" in out, out.strip())

    # final sync to be safe
    api("POST", "/api/sync", {})
    time.sleep(2)

    print("\n" + "=" * 56)
    passed = sum(1 for r in RESULTS if r[1])
    print(f"SUMMARY: {passed}/{len(RESULTS)} passed")
    fails = [r for r in RESULTS if not r[1]]
    if fails:
        print("FAILED:")
        for name, ok, detail in fails:
            print(f"  {name}: {detail}")
    return 0 if not fails else 1

if __name__ == "__main__":
    sys.exit(main())
