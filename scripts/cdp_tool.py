#!/usr/bin/env python3
"""CDP 驱动 PyWebView/WebView2 窗口的工具（配合 --cdp-port 使用）

用法：
  python cdp_tool.py <port> eval "<js>"        # 在页面里执行 JS 并打印结果
  python cdp_tool.py <port> reload              # 刷新页面
  python cdp_tool.py <port> screenshot <out.png>  # 截图（可选）

示例：
  python cdp_tool.py 9224 eval "({cards: document.querySelectorAll('.shot-card').length, sb: !!window.__sb})"
"""
import json
import sys
import urllib.request

import websocket


def get_target(port):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=5) as r:
        targets = json.loads(r.read())
    pages = [t for t in targets if t.get('type') == 'page']
    if not pages:
        raise SystemExit(f'no page target on port {port}')
    return pages[0]


def send(ws, method, params=None, mid=None):
    ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == mid:
            return msg


def main():
    port = int(sys.argv[1])
    action = sys.argv[2]
    target = get_target(port)
    ws = websocket.create_connection(target['webSocketDebuggerUrl'], timeout=10)
    mid = 0

    def next_id():
        nonlocal mid
        mid += 1
        return mid

    if action == 'eval':
        expr = sys.argv[3]
        r = send(ws, 'Runtime.evaluate',
                 {'expression': expr, 'returnByValue': True, 'awaitPromise': True},
                 next_id())
        if 'exceptionDetails' in r.get('result', {}):
            print('EXC:', json.dumps(r['result']['exceptionDetails'], ensure_ascii=False)[:500])
        else:
            print(json.dumps(r['result'].get('result', {}).get('value'), ensure_ascii=False))
    elif action == 'reload':
        send(ws, 'Page.enable', {}, next_id())
        send(ws, 'Page.reload', {'ignoreCache': True}, next_id())
        print('RELOADED')
    elif action == 'screenshot':
        r = send(ws, 'Page.captureScreenshot', {'format': 'png'}, next_id())
        import base64
        with open(sys.argv[3], 'wb') as f:
            f.write(base64.b64decode(r['result']['data']))
        print(f'SAVED {sys.argv[3]}')
    else:
        raise SystemExit(f'unknown action: {action}')
    ws.close()


if __name__ == '__main__':
    main()
