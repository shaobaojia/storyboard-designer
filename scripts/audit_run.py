#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 审计降噪包装器（2026-08 用户拍板 A 方案）：
# 审计输出重定向到日志文件，只回显 SUMMARY/失败项——上下文消耗从 50~100K 降到 <1K。
# 用法：
#   python scripts/audit_run.py          # 跑 41 + 右键菜单（串行）
#   python scripts/audit_run.py 41       # 只跑主审计
#   python scripts/audit_run.py ctx      # 只跑右键菜单审计
# MCP 端口自动探测（netstat 9876/9877，可被 SB_MCP_PORT 覆盖）
import subprocess, sys, os, time, tempfile

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


def run(tag, script):
    env = dict(os.environ)
    env.setdefault('SB_MCP', '127.0.0.1')
    env.setdefault('SB_MCP_PORT', detect_mcp_port())
    log = os.path.join(tempfile.gettempdir(), f'{tag}_{time.strftime("%Y%m%d_%H%M%S")}.log')
    with open(log, 'w', encoding='utf-8') as f:
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, script)],
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
    else:
        print('  ✅ 全部通过')
    return r.returncode


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    rc = 0
    if which in ('41', 'all'):
        rc |= run('audit41', 'audit.py')
    if which in ('ctx', 'all'):
        rc |= run('audit_ctx', 'audit_context_menu.py')
    sys.exit(rc)
