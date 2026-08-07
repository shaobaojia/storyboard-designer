#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 审计降噪包装器（2026-08 用户拍板 A 方案）：
# 审计输出重定向到日志文件，只回显 SUMMARY/失败项——上下文消耗从 50~100K 降到 <1K。
# 用法：
#   python scripts/audit_run.py          # 跑 41 + 右键菜单（串行）
#   python scripts/audit_run.py 41       # 只跑主审计
#   python scripts/audit_run.py ctx      # 只跑右键菜单审计
#   python scripts/audit_run.py --only=trash      # 只跑命中段（v0.9.14：透传 audit.py 段级筛选）
#   python scripts/audit_run.py --only=rename,undo  # 多关键词逗号分隔
# MCP 端口自动探测（netstat 9876/9877，可被 SB_MCP_PORT 覆盖）
import subprocess, sys, os, time, tempfile, socket, json, urllib.request

LOCK = os.path.join(tempfile.gettempdir(), 'sb_audit.lock')

def acquire_lock():
    """审计互斥锁：watchdog 与手动审计禁并行（共享 DB 互清，pitfall）"""
    if os.path.exists(LOCK):
        print(f'已有审计在跑（{LOCK}），本次跳过')
        sys.exit(3)
    open(LOCK, 'w').write(str(os.getpid()))
    return LOCK

SCRIPTS = os.path.dirname(os.path.abspath(__file__))


def detect_mcp_port():
    """自动探测 Blender MCP 实际监听端口（9876/9877，skill：动态端口别硬编码）"""
    try:
        # Windows netstat 输出是 GBK 代码页——text=True 默认 utf-8 解码会崩 reader 线程
        out = subprocess.run(['netstat', '-ano'], capture_output=True, text=True,
                             encoding='gbk', errors='replace', timeout=10,
                             creationflags=subprocess.CREATE_NO_WINDOW).stdout
        for port in ('9876', '9877'):
            if any(f':{port}' in line and 'LISTENING' in line for line in out.splitlines()):
                return port
    except Exception:
        pass
    return '9876'


def preflight():
    """审计前环境预检（2026-08-07 用户要求：确认环境正常再跑，杜绝假 FAIL）：
    MCP 命令响应 / HTTP 在线 / 单实例（8089+9876 同 PID）/ 无测试残留"""
    print('===== 环境预检 =====')
    problems = []
    port = detect_mcp_port()
    # 1. MCP 命令响应
    try:
        s = socket.create_connection(('127.0.0.1', int(port)), timeout=3)
        s.settimeout(8)
        s.send(json.dumps({'type': 'execute_code', 'params': {'code': 'import bpy; print(bpy.app.version_string)'}}).encode())
        data = b''
        while True:
            try:
                c = s.recv(4096)
                if not c: break
                data += c
                if b'result' in data: break
            except socket.timeout: break
        s.close()
        ok = b'4.' in data and b'result' in data
        print(f'  MCP 127.0.0.1:{port} 命令响应: {"OK" if ok else "无响应"}')
        if not ok: problems.append(f'MCP {port} 无响应（addon 卡死？重启 Blender）')
    except Exception as e:
        print(f'  MCP 127.0.0.1:{port} 连接失败: {e}')
        problems.append(f'MCP {port} 连不上: {e}')
    # 2. HTTP 在线
    try:
        with urllib.request.urlopen('http://127.0.0.1:8089/api/shots', timeout=5) as f:
            d = json.loads(f.read().decode())
        print(f'  HTTP 8089 /api/shots: OK（{len(d.get("shots", []))} 镜头）')
    except Exception as e:
        print(f'  HTTP 8089: 失败 {e}')
        problems.append(f'HTTP 8089 不通: {e}')
    # 3. 单实例（8089/9876 同 PID；8090/9877 出现 = 双实例）
    try:
        out = subprocess.run(['netstat', '-ano'], capture_output=True, text=True,
                             encoding='gbk', errors='replace', timeout=10,
                             creationflags=subprocess.CREATE_NO_WINDOW).stdout
        pids = {}
        for line in out.splitlines():
            for pp in ('8089', '8090', '9876', '9877'):
                if f':{pp}' in line and 'LISTENING' in line:
                    pids.setdefault(pp, set()).add(line.split()[-1])
        if pids.get('8090') or pids.get('9877'):
            print(f'  ⚠️ 多实例迹象: {pids}')
            problems.append(f'多实例并存 {pids}——8090/9877 出现 = 双 Blender，审计会连到坏实例')
        elif pids.get('8089') and pids.get('8089') != pids.get('9876'):
            print(f'  ⚠️ 8089({pids.get("8089")}) 与 9876({pids.get("9876")}) 归属不同 PID')
            problems.append('8089 与 9876 归属不同 PID——多实例，先 taskkill /F /IM blender.exe 清干净再拉起一个')
        elif pids.get('8089'):
            print(f'  单实例确认: 8089+9876 同 PID {pids.get("8089")} ✓')
        else:
            print('  ⚠️ 8089 无监听——Blender 没跑')
            problems.append('8089 无监听——先拉起 Blender')
    except Exception as e:
        print(f'  单实例检查异常: {e}')
        problems.append(f'单实例检查异常: {e}')
    # 4. 无测试残留
    try:
        with urllib.request.urlopen('http://127.0.0.1:8089/api/shots', timeout=5) as f:
            names = [s['name'] for s in json.loads(f.read().decode()).get('shots', [])]
        res = [n for n in names if n.startswith(('AUDIT', 'CTX', 'TMP'))]
        if res:
            print(f'  ⚠️ 测试残留: {res}')
            problems.append(f'测试残留 {res}——先清（shots+trash 的 AUDIT_/CTX/TMP）')
        else:
            print('  无测试残留 ✓')
    except Exception:
        pass
    if problems:
        print('===== 预检失败，不跑审计 =====')
        for p in problems:
            print('  -', p)
        return False
    print('===== 预检通过 =====')
    return True


def run(tag, script, extra=None):
    env = dict(os.environ)
    env.setdefault('SB_MCP', '127.0.0.1')
    env.setdefault('SB_MCP_PORT', detect_mcp_port())
    log = os.path.join(tempfile.gettempdir(), f'{tag}_{time.strftime("%Y%m%d_%H%M%S")}.log')
    with open(log, 'w', encoding='utf-8') as f:
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, script)] + (extra or []),
                           env=env, stdout=f, stderr=subprocess.STDOUT)
    with open(log, encoding='utf-8', errors='replace') as f:
        lines = f.readlines()
    fails = [ln.strip() for ln in lines if '[FAIL]' in ln or 'FAILED' in ln]
    summary = [ln.strip() for ln in lines if 'passed' in ln or 'SUMMARY' in ln or 'Traceback' in ln]
    print(f'===== {tag} ===== exit={r.returncode} 日志={log}')
    for ln in summary:
        print(' ', ln)
    if fails:
        print(f'  FAIL {len(fails)} 项：')
        for ln in fails:
            print('   ', ln)
        print(f'  详情见日志：{log}')
    elif r.returncode == 0:
        print('  ✅ 全部通过')
    else:
        print(f'  ⚠️ 异常退出 rc={r.returncode}（无 FAIL 记录，Traceback 见日志）')
        print(f'  详情见日志：{log}')
    return r.returncode


if __name__ == '__main__':
    args = sys.argv[1:]
    only = [a for a in args if a.startswith('--only=')]
    rest = [a for a in args if not a.startswith('--only=')]
    which = rest[0] if rest else 'all'
    rc = 0
    acquire_lock()
    try:
        if not preflight():
            sys.exit(2)
        if only:
            # --only 透传：只跑主审计命中段（ctx 审计尚未支持段筛选）
            rc |= run('audit_only', 'audit.py', extra=[only[0]])
        else:
            if which in ('41', 'all'):
                rc |= run('audit41', 'audit.py')
            if which in ('ctx', 'all'):
                rc |= run('audit_ctx', 'audit_context_menu.py')
    finally:
        if os.path.exists(LOCK):
            os.unlink(LOCK)
    sys.exit(rc)
