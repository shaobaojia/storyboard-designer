#!/usr/bin/env python3
"""PyWebView 窗口交互实测：右键菜单 / 单击+空格展开 / 拖图建镜头 / localStorage 持久化
用法: python pwv_interact.py <port> <phase>
  phase: menu | expand | drag | storage
"""
import json
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1])
PHASE = sys.argv[2]


def get_target():
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json', timeout=5) as r:
        ts = json.loads(r.read())
    pages = [t for t in ts if t.get('type') == 'page']
    return pages[0]


class CDP:
    def __init__(self):
        t = get_target()
        self.ws = websocket.create_connection(t['webSocketDebuggerUrl'], timeout=10)
        self.mid = 0

    def call(self, method, params=None):
        self.mid += 1
        self.ws.send(json.dumps({'id': self.mid, 'method': method, 'params': params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.mid:
                return m

    def ev(self, expr):
        r = self.call('Runtime.evaluate',
                      {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        if 'exceptionDetails' in r.get('result', {}):
            return 'EXC: ' + json.dumps(r['result']['exceptionDetails'], ensure_ascii=False)[:300]
        return r['result'].get('result', {}).get('value')

    def mouse_click(self, x, y, button='left', clicks=1):
        self.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y,
                                               'button': button, 'clickCount': clicks})
        self.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y,
                                               'button': button, 'clickCount': clicks})

    def key(self, key, code, modifiers=0):
        self.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': key, 'code': code,
                                             'modifiers': modifiers, 'windowsVirtualKeyCode': 32})
        self.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': key, 'code': code,
                                             'modifiers': modifiers, 'windowsVirtualKeyCode': 32})


def first_card_center(c):
    r = c.ev("""(() => {
        window.scrollTo(0, 0);
        const el = document.querySelector('.shot-card');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};
    })()""")
    return r


if PHASE == 'menu':
    c = CDP()
    time.sleep(0.5)
    p = first_card_center(c)
    print('card center:', p)
    c.mouse_click(p['x'], p['y'], button='right')
    time.sleep(0.5)
    menu = c.ev("(() => { const m = document.getElementById('contextMenu'); "
                "return m ? {display: getComputedStyle(m).display, items: m.querySelectorAll('.menu-item').length} : null; })()")
    print('right-click menu:', menu)
    # 关菜单：点空白处
    c.mouse_click(50, 400, button='left')
    time.sleep(0.3)
    print('menu after dismiss:', c.ev("(() => { const m = document.getElementById('contextMenu'); "
                                      "return m ? getComputedStyle(m).display : null; })()"))

elif PHASE == 'expand':
    c = CDP()
    time.sleep(0.5)
    p = first_card_center(c)
    c.mouse_click(p['x'], p['y'], button='left')
    time.sleep(0.3)
    sel = c.ev("window.__sb ? window.__sb.state.selectedIds.size : 'no-sb'")
    print('selectedIds after click:', sel)
    c.key(' ', 'Space')
    time.sleep(1.2)
    print('expanded after space:', c.ev("window.__sb ? window.__sb.state.expandedShotIds.size : 'no-sb'"))
    # 再按空格折叠
    c.key(' ', 'Space')
    time.sleep(1.2)
    print('expanded after 2nd space:', c.ev("window.__sb ? window.__sb.state.expandedShotIds.size : 'no-sb'"))

elif PHASE == 'drag':
    # 拖本地图片进页面 → 建镜头（Input.dispatchDragEvent 带真实文件路径）
    import os
    shot_dir = 'N:/Projects/请投币/三维辅助/test/storyboard_test_storyboard'
    candidates = []
    for root, dirs, files in os.walk(shot_dir):
        for f in files:
            if f.endswith('.jpg') and 'thumb' in f:
                candidates.append(os.path.join(root, f))
        if len(candidates) >= 1:
            break
    if not candidates:
        print('NO TEST IMAGE FOUND')
        sys.exit(1)
    img = candidates[0]
    print('drag file:', img)
    c = CDP()
    time.sleep(0.5)
    p = first_card_center(c)
    # 拖到第二行空白处（避免落在卡片上）
    drop_x, drop_y = p['x'], p['y'] + 260
    data = {'items': [], 'files': [img.replace('/', '\\')]}
    c.call('Input.dispatchDragEvent', {'type': 'dragEnter', 'x': drop_x, 'y': drop_y, 'data': data})
    time.sleep(0.3)
    c.call('Input.dispatchDragEvent', {'type': 'dragOver', 'x': drop_x, 'y': drop_y, 'data': data})
    time.sleep(0.3)
    before = c.ev("window.__sb ? window.__sb.state.shots.length : 'no-sb'")
    c.call('Input.dispatchDragEvent', {'type': 'drop', 'x': drop_x, 'y': drop_y, 'data': data})
    time.sleep(2.5)
    after = c.ev("window.__sb ? window.__sb.state.shots.length : 'no-sb'")
    print(f'shots before={before} after={after}')

elif PHASE == 'storage':
    c = CDP()
    # 改 localStorage 视图模式 → list
    c.ev("localStorage.setItem('sb-view', 'list'); 1")
    # 切视图（模拟用户）
    r = c.ev("(() => { if (window.__sb && window.__sb.toggleView) { window.__sb.toggleView(); return window.__sb.state.viewMode; } return 'no-toggle'; })()")
    print('viewMode after toggle:', r)
    print('localStorage sb-view:', c.ev("localStorage.getItem('sb-view')"))

else:
    print('unknown phase')
