#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""审计 watchdog（v0.9.14 用户拍板：改代码自动触发审计）

监听源码目录变化，自动部署 + 自动跑对应审计：
- web/*.js|css|html 变化 → 部署 web/ → 跑 web_audit.py（前端交互 23 项 ~40s，不碰 Blender）
- core/*.py / __init__.py 变化 → 部署 → 攒批防抖 30s（连续改动只重启一次）
  → 重启 Blender（读 instances.json 拿 blend 路径）→ 跑 audit_run.py all（41+12 ~5min）
- 审计结果写 ~/AppData/Local/hermes/tmp/audit_watch.log + stdout（Hermes background 可 poll）
- 与手动审计互斥：audit_run.py / web_audit.py 有 sb_audit.lock（拿到锁才跑）

用法: python scripts/watch_audit.py   （常驻，Ctrl+C 退出）
"""
import os, sys, time, subprocess, json, shutil

SRC = r'D:/kimiwork/Blender分镜管理/storyboard-designer'
DST = os.path.expandvars(r'%APPDATA%/Blender Foundation/Blender/4.5/scripts/addons/storyboard_designer')
BLENDER = r'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe'
LOG = os.path.expanduser('~/AppData/Local/hermes/tmp/audit_watch.log')
BACK_DEBOUNCE = 30  # 后端改动攒批窗口（秒）
WEB_DEBOUNCE = 3    # 前端改动防抖（秒）
SCAN_INTERVAL = 2

def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def scan():
    """返回 {绝对路径: mtime} 快照（只关心源码目录的 web/core/__init__.py）"""
    snap = {}
    for root in ('web', 'core'):
        base = os.path.join(SRC, root)
        for dirpath, dirnames, filenames in os.walk(base):
            for fn in filenames:
                p = os.path.join(dirpath, fn)
                try:
                    snap[p] = os.path.getmtime(p)
                except OSError:
                    pass
    for fn in ('__init__.py',):
        p = os.path.join(SRC, fn)
        try:
            snap[p] = os.path.getmtime(p)
        except OSError:
            pass
    return snap

def deploy(changed):
    """把改动文件 cp 到部署目录（逐文件 cp -f，防 cp -r 半覆盖坑）"""
    for p in changed:
        rel = os.path.relpath(p, SRC)
        dst = os.path.join(DST, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            shutil.copy2(p, dst)
            log(f'deploy {rel}')
        except Exception as e:
            log(f'deploy FAIL {rel}: {e}')

def restart_blender():
    log('重启 Blender（后端改动）...')
    subprocess.run(['taskkill', '/F', '/IM', 'blender.exe'], capture_output=True)
    time.sleep(3)
    # 读 instances.json 拿当前实际打开的 blend（可能不是默认工程）
    blend = None
    inst_path = os.path.join(DST, 'instances.json')
    try:
        with open(inst_path, encoding='utf-8') as f:
            inst = json.load(f)
        if inst and inst[0].get('blend'):
            blend = inst[0]['blend']
    except Exception as e:
        log(f'instances.json 读取失败: {e}')
    if not blend:
        blend = r'N:/Projects/请投币/三维辅助/test/storyboard_test.blend'
        log(f'用默认 blend: {blend}')
    subprocess.Popen([BLENDER, blend], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # 等端口就绪（8089 或 8090）
    for _ in range(30):
        time.sleep(2)
        try:
            out = subprocess.run(['netstat', '-ano'], capture_output=True, text=True,
                                 encoding='gbk', errors='replace', timeout=5,
                                 creationflags=subprocess.CREATE_NO_WINDOW).stdout
            if any(f':8089' in ln and 'LISTENING' in ln for ln in out.splitlines()):
                log('Blender 就绪（8089 LISTENING）')
                return True
        except Exception:
            pass
    log('⚠️ Blender 60s 未就绪')
    return False

def run_audit(kind):
    env = dict(os.environ)
    cmd = [sys.executable, os.path.join(SRC, 'scripts', 'audit_run.py'), 'all']
    if kind == 'web':
        cmd = [sys.executable, os.path.join(SRC, 'scripts', 'web_audit.py')]
    log(f'跑 {kind} 审计: {" ".join(cmd[-2:])}')
    try:
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=900,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        # 只记摘要行（降噪）
        lines = [ln for ln in (r.stdout or '').splitlines()
                 if 'SUMMARY' in ln or 'passed' in ln or 'FAIL' in ln or '预检' in ln]
        log(f'{kind} 审计 rc={r.returncode}: ' + ' | '.join(lines[-4:]))
    except subprocess.TimeoutExpired:
        log(f'⚠️ {kind} 审计超时（900s）')
    except Exception as e:
        log(f'⚠️ {kind} 审计异常: {e}')

def wait_stable(snap, debounce):
    """等待改动稳定（防抖窗口内无新变化才返回最终快照）"""
    cur = snap
    while True:
        time.sleep(debounce)
        nxt = scan()
        changed = [p for p in nxt if p not in cur or nxt[p] != cur[p]]
        if not changed:
            return cur
        cur = nxt

def main():
    log('=' * 50)
    log('审计 watchdog 启动（Ctrl+C 退出）')
    log(f'源码: {SRC}')
    log(f'部署: {DST}')
    snap = scan()
    log(f'初始快照 {len(snap)} 文件')
    while True:
        time.sleep(SCAN_INTERVAL)
        try:
            cur = scan()
        except Exception as e:
            log(f'扫描异常: {e}')
            continue
        changed = [p for p in cur if p not in snap or cur[p] != snap[p]]
        if changed:
            rels = [os.path.relpath(p, SRC) for p in changed]
            log(f'检测到改动: {rels}')
            cur = wait_stable(cur, WEB_DEBOUNCE)
            cur = scan()
            changed = [p for p in cur if p not in snap or cur[p] != snap[p]]
            web = [p for p in changed if os.path.relpath(p, SRC).startswith('web')]
            back = [p for p in changed if (os.path.relpath(p, SRC).startswith('core')
                                           or p.endswith('__init__.py'))]
            if web:
                deploy(web)
                run_audit('web')
            if back:
                deploy(back)
                # 后端攒批：等 30s 无新改动才重启（连续改代码只重启一次）
                log(f'后端改动攒批 {BACK_DEBOUNCE}s（连续改动会重置计时）...')
                cur = wait_stable(cur, BACK_DEBOUNCE)
                cur = scan()
                back2 = [p for p in cur if (os.path.relpath(p, SRC).startswith('core')
                                            or p.endswith('__init__.py'))
                         and (p not in snap or cur[p] != snap[p])]
                if back2:
                    deploy(back2)
                restart_blender()
                run_audit('back')
        snap = cur

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('watchdog 退出')
