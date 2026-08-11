# -*- coding: utf-8 -*-
"""审计三脚本公共层（v0.9.71 屎山治理②）：blender()/api()/state()/wait_until 一份实现。

用法：
    from audit_lib import MCP_HOST, MCP_PORT, HTTP, blender, api, state, wait_until, print_record

record() 各脚本签名不同（audit 带 category），公共打印逻辑用 print_record()。
"""
import socket, json, urllib.request, time, os

MCP_HOST = os.environ.get("SB_MCP", "192.168.3.71")
MCP_PORT = int(os.environ.get("SB_MCP_PORT", "9876"))
HTTP = f"http://{MCP_HOST}:{os.environ.get('SB_HTTP_PORT', '8089')}"


def print_record(name, ok, detail=""):
    """record() 的公共打印部分；RESULTS.append 由各脚本自己做（元组形状不同）。"""
    ts = time.strftime('%H:%M:%S')
    print(f"  [{ts}] [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))


def wait_until(desc, cond, timeout=10.0, interval=0.25):
    """轮询 cond() 直到 True（完成即继续）；超时抛 TimeoutError。查询瞬时异常不算超时。
    稳定确认：cond True 后 0.3s 再验一次——queue 命令分步执行（DB 先写、场景后动），
    避免 HTTP 查询命中命令执行中途窗口（v0.9.14 轮询化实测 Soft delete/Purge 假 FAIL）。"""
    deadline = time.time() + timeout
    while True:
        try:
            if cond():
                time.sleep(0.3)
                if cond():
                    return
        except Exception:
            pass
        if time.time() >= deadline:
            raise TimeoutError(f"等待超时: {desc}（>{timeout}s）")
        time.sleep(interval)


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
