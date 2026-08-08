#!/usr/bin/env python3
"""PyWebView 分镜管理器窗口启动器（runtime 容器内运行）

职责：
1. 单实例：锁文件记录 PID，旧进程存活则强杀（关旧开新）
2. watchdog：Blender 进程死亡 → 销毁窗口、进程退出（与 Blender 同进退，
   覆盖正常退出/崩溃闪退/任务管理器强杀等任何关闭方式）
3. 固定 storage_path：localStorage 持久化（与 Edge 的存储天然隔离）
4. 可选 --cdp-port：WebView2 调试端口（自动化测试/调试用，交付默认不开）

用法：
    pythonw.exe launcher.py --url http://localhost:8089 --blender-pid <pid>
    [--cdp-port 9223] [--title 分镜管理器]

注意：本文件由 scripts/make_runtime.py 拷贝进 runtime 容器，改源码后
重新制作 runtime 或手动拷一份到部署目录 _runtime/launcher.py。
"""
import argparse
import ctypes
import os
import subprocess
import sys
import threading
import time

import webview

LOCK_DIR = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'storyboard-designer-webview',
)
LOCK_FILE = os.path.join(LOCK_DIR, 'launcher.pid')
LOG_FILE = os.path.join(LOCK_DIR, 'launcher.log')
# 标题栏图标（与 launcher.py 同目录的 app.ico，由 scripts/svg2ico.py 从 SVG 生成）
ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.ico')

# Blender 进程 PID（main() 里从 --blender-pid 赋值，on_started 悬浮化用）
_BLENDER_PID = 0


def log(msg):
    try:
        os.makedirs(LOCK_DIR, exist_ok=True)
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f'[{time.strftime("%H:%M:%S")}] {msg}\n')
    except OSError:
        pass

STILL_ACTIVE = 259
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def pid_alive(pid):
    """Windows: OpenProcess + GetExitCodeProcess 判活（零额外依赖）"""
    if not pid or pid <= 0:
        return False
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not h:
        return False
    try:
        code = ctypes.c_ulong()
        if not k32.GetExitCodeProcess(h, ctypes.byref(code)):
            return True
        return code.value == STILL_ACTIVE
    finally:
        k32.CloseHandle(h)


def kill_old_instance():
    """单实例：锁文件里的 PID 还活着就强杀（关旧开新）"""
    old_pid = None
    try:
        with open(LOCK_FILE, 'r', encoding='utf-8') as f:
            old_pid = int(f.read().strip())
    except (OSError, ValueError):
        return
    if old_pid and old_pid != os.getpid() and pid_alive(old_pid):
        try:
            subprocess.run(
                ['taskkill', '/F', '/PID', str(old_pid)],
                capture_output=True, timeout=10,
            )
            log(f'killed old instance {old_pid}')
        except Exception as e:
            log(f'kill old instance {old_pid} failed: {e}')
        time.sleep(0.5)
    try:
        os.unlink(LOCK_FILE)
    except OSError:
        pass


def write_lock():
    os.makedirs(LOCK_DIR, exist_ok=True)
    with open(LOCK_FILE, 'w', encoding='utf-8') as f:
        f.write(str(os.getpid()))
    log(f'lock written: {os.getpid()}')


def remove_lock():
    try:
        if os.path.exists(LOCK_FILE):
            with open(LOCK_FILE, 'r', encoding='utf-8') as f:
                cur = f.read().strip()
            if cur == str(os.getpid()):
                os.unlink(LOCK_FILE)
                log(f'lock removed: {os.getpid()}')
            else:
                log(f'lock skip (owner {cur} != {os.getpid()})')
    except OSError as e:
        log(f'remove_lock error: {e}')


def watchdog(blender_pid, window):
    """Blender 进程死亡 → 销毁窗口（1s 内），launcher 随之退出"""
    while True:
        time.sleep(1.0)
        if not pid_alive(blender_pid):
            try:
                window.destroy()
            except Exception:
                pass
            return


def find_blender_hwnd(blender_pid):
    """EnumWindows 按 PID 找 Blender 主窗口句柄（可见顶层窗口）"""
    result = []

    def cb(hwnd, lparam):
        if ctypes.windll.user32.IsWindowVisible(hwnd):
            pid = ctypes.c_ulong()
            ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value == blender_pid:
                result.append(hwnd)
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    ctypes.windll.user32.EnumWindows(WNDENUMPROC(cb), 0)
    return result[0] if result else 0


def attach_to_blender(window, blender_pid):
    """悬浮化：owner=Blender 主窗口 + 工具窗口样式（纯 ctypes）。

    效果与 Blender 自带悬浮窗口一致：不进任务栏/Alt+Tab、永远在 Blender 之上、
    Blender 最小化时窗口自动隐藏、恢复时自动显示。
    ⚠️ 不能用 pythonnet 控件属性（native.ShowInTaskbar=False 与 WebView2 初始化
    竞争 → UI 线程死锁 → 窗口假死且拖死 Blender 的最小化，2026-08-08 实测）。
    """
    try:
        hwnd = window.native.Handle.ToInt32()
        parent = find_blender_hwnd(blender_pid)
        if parent:
            # GWLP_HWNDPARENT = -8：设置 owner 关系（窗口管理器级，不依赖 UI 线程）
            ctypes.windll.user32.SetWindowLongPtrW(hwnd, -8, parent)
            log(f'attached to blender hwnd={parent}')
        else:
            log('blender hwnd not found, window stays standalone')
        # 工具窗口样式：去 WS_EX_APPWINDOW(0x40000) 加 WS_EX_TOOLWINDOW(0x80)
        ex = ctypes.windll.user32.GetWindowLongW(hwnd, -20)
        new_ex = (ex | 0x80) & ~0x40000
        ctypes.windll.user32.SetWindowLongW(hwnd, -20, new_ex)
        # 应用样式：SWP_FRAMECHANGED(0x20) + NOMOVE|NOSIZE|NOZORDER|NOACTIVATE
        ctypes.windll.user32.SetWindowPos(
            hwnd, 0, 0, 0, 0, 0, 0x20 | 0x2 | 0x1 | 0x4 | 0x10)
        log('toolwindow style applied')
        return hwnd, parent
    except Exception as e:
        log(f'attach_to_blender failed: {e}')
        return None, 0


def apply_dark_titlebar(window):
    """强制 WinForms 标题栏深色（不随系统浅色主题），与深色页面融合"""
    try:
        native = window.native
        hwnd = native.Handle.ToInt32()
        val = ctypes.c_int(1)
        # DWMWA_USE_IMMERSIVE_DARK_MODE = 20（Win10 2004+）
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, 20, ctypes.byref(val), ctypes.sizeof(val))
        corner = ctypes.c_int(2)
        # DWMWA_WINDOW_CORNER_PREFERENCE = 38，2 = 圆角
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, 38, ctypes.byref(corner), ctypes.sizeof(corner))
        # v0.9.26：DWM 深色标题栏重绘不重读 WM_SETICON 图标（实测：浅色阶段带图标，
        # 深色切换后图标消失只剩文字）——重新回设图标强制 DWM 重绘标题栏图标
        try:
            u32 = ctypes.windll.user32
            for ic in (0, 2, 1):  # ICON_SMALL / ICON_SMALL2 / ICON_BIG
                h = u32.SendMessageW(hwnd, 0x7F, ic, 0)  # WM_GETICON
                if h:
                    u32.SendMessageW(hwnd, 0x80, ic, h)  # WM_SETICON
            log(f'titlebar icon re-applied after dark mode (hwnd={hwnd})')
        except Exception as e:
            log(f'titlebar icon re-apply failed: {e}')
        log(f'dark titlebar applied (hwnd={hwnd})')
    except Exception as e:
        log(f'dark titlebar failed: {e}')


def on_started():
    """GUI 循环启动后：等窗口真正显示，错开初始化窗口期，再上深色标题栏 + 悬浮化"""
    try:
        w = webview.windows[0]
        w.events.shown.wait(10)
        time.sleep(1.0)  # 等 WebView2 初始化稳定（避免样式/owner 操作撞初始化）
        apply_dark_titlebar(w)
        attach_to_blender(w, _BLENDER_PID)
    except Exception as e:
        log(f'on_started error: {e}')


def main():
    global _BLENDER_PID
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--blender-pid', type=int, required=True)
    ap.add_argument('--cdp-port', type=int, default=None)
    ap.add_argument('--title', default='分镜管理器')
    args = ap.parse_args()

    _BLENDER_PID = args.blender_pid
    kill_old_instance()
    write_lock()
    log(f'start: url={args.url} blender_pid={args.blender_pid} cdp={args.cdp_port}')

    if args.cdp_port:
        # CDP 调试端口全走环境变量（pywebview 的 REMOTE_DEBUGGING_PORT 传参
        # 无法附带 --remote-allow-origins；runtime 的 edgechromium.py 已补丁
        # 支持合并 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS）
        os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = (
            os.environ.get('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', '')
            + f' --remote-debugging-port={args.cdp_port} --remote-allow-origins=*'
        )

    window = webview.create_window(
        args.title,
        args.url,
        width=1440, height=900,
        min_size=(960, 600),
        resizable=True,
    )
    threading.Thread(
        target=watchdog, args=(args.blender_pid, window), daemon=True
    ).start()
    log('window created, entering gui loop')

    start_kwargs = dict(
        private_mode=False,
        storage_path=LOCK_DIR,
    )
    if os.path.isfile(ICON_PATH):
        start_kwargs['icon'] = ICON_PATH
    try:
        webview.start(
            on_started,
            **start_kwargs,
        )
        log('gui loop returned')
    finally:
        log('finally: remove_lock')
        remove_lock()
    log('exit')


if __name__ == '__main__':
    main()
