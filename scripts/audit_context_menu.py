#!/usr/bin/env python3
"""右键菜单专项审计（v0.9.14 拆 4 段，每段自建自清）

逐项验证网页端右键菜单的 4 个功能（Open/Re-render/Duplicate/Delete）
都真实作用到 Blender 端。与 scripts/audit.py 的区别：专注右键菜单
路径（/api/shot/{id} 的 4 个 action），用真实 shot 而非一次性 AUDIT shot。

用法:
    python3 scripts/audit_context_menu.py             # 全跑（4 段串行）
    python3 scripts/audit_context_menu.py --only=open       # 只跑 open 段
    python3 scripts/audit_context_menu.py --only=rerender   # 只跑重拍封面段
    python3 scripts/audit_context_menu.py --only=duplicate  # 只跑 duplicate 段
    python3 scripts/audit_context_menu.py --only=delete     # 只跑 delete 段
    python3 scripts/audit_context_menu.py --only=open,delete  # 多段逗号分隔

每段独立建 CTX_TEST 镜头 → 测 → 清理（软删+purge），无跨段数据依赖。
"""
import socket, json, urllib.request, time, os, sys

MCP_HOST = os.environ.get("SB_MCP", "192.168.3.71")
MCP_PORT = int(os.environ.get("SB_MCP_PORT", "9876"))
HTTP = f"http://{MCP_HOST}:8089"

RESULTS = []

def record(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    ts = time.strftime('%H:%M:%S')
    print(f"  [{ts}] [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))

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

def setup_shot():
    """建一个专用测试镜头，返回 (tid, name)"""
    r = api("POST", "/api/shots", {"name": "CTX_TEST", "duration": 2.0, "type": "3d"})
    tid = r["id"]
    time.sleep(3)
    return tid, "CTX_TEST"

def cleanup_shot(tid, name="CTX_TEST"):
    """软删 + purge，彻底清掉测试镜头（含垃圾桶）"""
    try:
        api("POST", f"/api/shot/{tid}", {"action": "delete"})
        time.sleep(2)
        trash = api("GET", "/api/trash").get("shots", [])
        tid2 = next((s["id"] for s in trash if s["name"] == name), None)
        if tid2:
            api("POST", f"/api/shot/{tid2}", {"action": "purge"})
            time.sleep(2)
    except Exception as e:
        print(f"  [cleanup warn] {e}")

def seg_open():
    print("\n[1] right-click Open Shot")
    tid, name = setup_shot()
    api("POST", f"/api/shot/{tid}", {"action": "open"})
    time.sleep(2)
    cur = state()["current"]
    record("Open Shot -> Blender 切换到该场景", cur == "Shot_CTX_TEST", f"current={cur}")
    cleanup_shot(tid)

def seg_rerender():
    print("\n[2] right-click 重拍封面 (rerender)")
    tid, name = setup_shot()
    api("POST", f"/api/shot/{tid}", {"action": "rerender"})
    time.sleep(8)
    out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "CTX_TEST_{tid}")
print(os.listdir(d) if os.path.exists(d) else "MISSING")
''')
    # v0.9.4+：JPG 化后重拍封面帧输出 f00000_still.jpg / f00000_thumb.jpg（不再拍 PNG）
    ok = "f00000_still.jpg" in out and "f00000_thumb.jpg" in out
    record("重拍封面 -> 封面帧落盘(f00000_*)", ok, out.strip()[:60])
    try:
        # 网页可见性：从 API 读封面帧 imageUrl（带帧级 ver 缓存戳），HTTP 检查
        shot = next(s for s in api("GET", "/api/shots")["shots"] if s["id"] == tid)
        url = shot["frames"][0]["imageUrl"]
        resp = urllib.request.urlopen(f"{HTTP}{url}", timeout=5)
        record("重拍封面 -> 封面帧网页可见", resp.status == 200, f"{resp.status} {url}")
    except Exception as e:
        record("重拍封面 -> 封面帧网页可见", False, str(e)[:60])
    cleanup_shot(tid)

def seg_duplicate():
    print("\n[3] right-click Duplicate")
    tid, name = setup_shot()
    api("POST", f"/api/shot/{tid}", {"action": "duplicate", "new_name": "CTX_TEST_COPY"})
    time.sleep(3)
    st = state()
    db_ok = "CTX_TEST_COPY" in st["db"]
    sc_ok = "Shot_CTX_TEST_COPY" in st["scenes"]
    record("Duplicate -> DB 新增记录", db_ok, f"DB={st['db']}")
    record("Duplicate -> Blender 新建场景", sc_ok,
           f"scenes={[s for s in st['scenes'] if 'CTX' in s]}")
    # 清理 copy：软删进垃圾桶（顺带断言 copy 的删除链路）
    shots = api("GET", "/api/shots")["shots"]
    copy_shot = next((s for s in shots if s["name"] == "CTX_TEST_COPY"), None)
    if copy_shot:
        api("POST", f"/api/shot/{copy_shot['id']}", {"action": "delete"})
        time.sleep(3)
        st = state()
        record("Delete(copy) -> DB 记录移除(垃圾桶)", "CTX_TEST_COPY" not in st["db"])
        record("Delete(copy) -> Blender 场景移除", "Shot_CTX_TEST_COPY" not in st["scenes"])
        api("POST", f"/api/shot/{copy_shot['id']}", {"action": "purge"})
        time.sleep(2)
    cleanup_shot(tid)

def seg_delete():
    print("\n[4] right-click Delete")
    tid, name = setup_shot()
    # 软删语义 v0.8.2 用户拍板：目录保留供垃圾桶恢复
    api("POST", f"/api/shot/{tid}", {"action": "delete"})
    time.sleep(3)
    st = state()
    record("Delete(orig) -> DB 记录移除(垃圾桶)", "CTX_TEST" not in st["db"])
    record("Delete(orig) -> Blender 场景移除", "Shot_CTX_TEST" not in st["scenes"])
    out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "CTX_TEST_{tid}")
print("EXISTS" if os.path.exists(d) else "GONE")
''')
    record("Delete(orig) -> 软删后目录保留(可恢复)", "EXISTS" in out, out.strip())
    # purge：彻底删除才清磁盘目录
    api("POST", f"/api/shot/{tid}", {"action": "purge"})
    time.sleep(3)
    out = blender(f'''import bpy, os
project_dir = os.path.join(os.path.dirname(bpy.data.filepath),
    os.path.splitext(os.path.basename(bpy.data.filepath))[0] + "_storyboard")
d = os.path.join(project_dir, "shots", "CTX_TEST_{tid}")
print("EXISTS" if os.path.exists(d) else "GONE")
''')
    record("Purge -> 磁盘目录清理", "GONE" in out, out.strip())
    trash = api("GET", "/api/trash")
    record("Purge -> 垃圾桶清空", len(trash.get("shots", [])) == 0,
           f"trash={[s['name'] for s in trash.get('shots', [])]}")
    # 最终 sync 兜底
    api("POST", "/api/sync", {})
    time.sleep(2)


SEGS = {
    "open":      (["open"], seg_open),
    "rerender":  (["rerender", "重拍"], seg_rerender),
    "duplicate": (["duplicate", "copy"], seg_duplicate),
    "delete":    (["delete", "purge"], seg_delete),
}

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

    only = None
    for a in sys.argv[1:]:
        if a.startswith("--only="):
            only = [k.strip().lower() for k in a[7:].split(",") if k.strip()]
    active = [sid for sid in SEGS if not only or
              any(k == sid or any(k in n for n in SEGS[sid][0]) for k in only)]
    if only and not active:
        print(f"--only 未命中任何段。可用：{', '.join(SEGS)}")
        return 1
    if only:
        print(f"[--only] 激活段: {active}")

    for sid in active:
        SEGS[sid][1]()

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
