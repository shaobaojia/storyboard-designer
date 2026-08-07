#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""前端交互审计（WebBridge 驱动）v0.9.14

验证浏览器交互层：渲染 / 视图 / 展开折叠 / 右键菜单 / 搜索 / 缩放 / 预览框 / 台词条 / 键盘。
与 audit.py（后端：Blender ops + HTTP API）互补——本脚本测 DOM/交互层。

用法:
    python scripts/web_audit.py                  # 全跑（9 段）
    python scripts/web_audit.py --only=render    # 只跑 render 段
    python scripts/web_audit.py --only=menu,search  # 多段逗号分隔

依赖: WebBridge daemon（127.0.0.1:10086，Edge 常驻）+ Blender HTTP 8089。
每段自还原现场（视图/展开/缩放/预览/台词/搜索），收尾全局兜底还原。
"""
import json, subprocess, tempfile, os, sys, time, urllib.request

LOCK = os.path.join(tempfile.gettempdir(), 'sb_audit.lock')

def acquire_lock():
    """审计互斥锁：watchdog 与手动审计禁并行（共享 DB 互清，pitfall）"""
    if os.path.exists(LOCK):
        print(f'已有审计在跑（{LOCK}），本次跳过')
        sys.exit(3)
    open(LOCK, 'w').write(str(os.getpid()))
    return LOCK

HTTP = os.environ.get("SB_HTTP_PORT", "8089")
PAGE = f"http://127.0.0.1:{HTTP}"
SESSION = "sb-test"
RESULTS = []

# ---------------- WebBridge 调用模板（kimi-webbridge skill 规范） ----------------

def wb(action, args, session=SESSION):
    body = json.dumps({"session": session, "action": action, "args": args}, ensure_ascii=False)
    tf = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8')
    tf.write(body); tf.close()
    result = subprocess.run(
        ['curl.exe', '-s', '-X', 'POST', 'http://127.0.0.1:10086/command',
         '-H', 'Content-Type: application/json', '--data-binary', f'@{tf.name}'],
        capture_output=True, text=True, timeout=20)
    os.unlink(tf.name)
    return json.loads(result.stdout)

def ev(code):
    """只用于纯查询（读状态/DOM），带重试；有副作用的驱动一律用 wb('evaluate') 一次性调"""
    for _ in range(3):
        r = wb('evaluate', {'code': code})
        if r.get('ok'):
            v = r['data'].get('value')
            if v is None: return None
            if isinstance(v, str) and (v.startswith('{') or v.startswith('[')):
                try: return json.loads(v)
                except: return v
            return v
        time.sleep(1.5)
    return None

def drive(code):
    """一次性执行有副作用的编排函数（ev() 的重试会 double-invoke，pitfall 10a）"""
    wb('evaluate', {'code': code})
    time.sleep(0.4)

def cdp(method, params):
    return wb('cdp', {'method': method, 'params': params})

def real_click(x, y, button='left'):
    cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': button, 'clickCount': 1})
    cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': button, 'clickCount': 1})

def key_press(key, code=None):
    cdp('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': key, 'code': code or key})
    cdp('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': key, 'code': code or key})

def record(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))

# ---------------- 工具 ----------------

def api_shots():
    with urllib.request.urlopen(f'{PAGE}/api/shots', timeout=5) as f:
        return json.loads(f.read().decode())['shots']

def wait_anim(timeout=8.0):
    """轮询全部卡片 transform 归 none（动画落定）"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        ok = ev(r"(() => { return [...document.querySelectorAll('.shot-card')].every(c => getComputedStyle(c).transform === 'none'); })()")
        if ok:
            return True
        time.sleep(0.3)
    return False

def sbs():
    """读 __sb.state 快照"""
    return ev(r"(() => { return window.__sb ? window.__sb.state : null; })()")

def grid_class():
    return ev(r"(() => { const g = document.getElementById('grid'); return g ? g.className : 'no-grid'; })()")

def card_count():
    return ev(r"(() => { return document.querySelectorAll('.shot-card').length; })()")

def find_multi_shot():
    """第一个多图镜头（frames>1），返回 {id, name, n} 或 None"""
    shots = api_shots()
    for s in shots:
        n = len(s.get('frames') or [])
        if n > 1:
            return {'id': s['id'], 'name': s['name'], 'n': n}
    return None

# ---------------- 段 ----------------

def seg_render():
    print("\n[1] Render 渲染")
    shots = api_shots()
    n = len(shots)
    cards = card_count()
    record("渲染数 = API 镜头数", cards == n, f"cards={cards}, api={n}")
    multi = find_multi_shot()
    if multi:
        folded = ev(rf"(() => {{ const c = document.querySelector('.shot-card[data-id=\"{multi['id']}\"]'); return c ? c.querySelectorAll('.frame-stack .frame-img').length : -1; }})()")
        record("多图折叠态帧格节点数 = frames 数", folded == multi['n'], f"folded={folded}, frames={multi['n']}")

def seg_view():
    print("\n[2] View 视图切换")
    orig = grid_class()
    drive("window.__sb.toggleView()")
    time.sleep(1.0)
    cls = grid_class()
    record("宫格->列表", 'list-mode' in cls and 'grid' in cls, cls)
    n_list = card_count()
    record("列表卡片数不变", n_list == len(api_shots()), f"cards={n_list}")
    drive("window.__sb.toggleView()")
    time.sleep(1.0)
    record("列表->宫格还原", grid_class() == orig, grid_class())

def seg_expand():
    print("\n[3] Expand 展开折叠")
    multi = find_multi_shot()
    if multi:
        sid = multi['id']
        drive(f"window.__sb.expandAnimated('{sid}')")
        time.sleep(1.0)
        exp = ev(rf"(() => {{ return window.__sb.isExpanded('{sid}'); }})()")
        # 展开态帧格是独立卡片（.shot-card.frame-cell 兄弟节点，不在折叠卡内部）
        cells = ev(rf"(() => {{ return document.querySelectorAll('.shot-card.frame-cell[data-id=\"{sid}\"]').length; }})()")
        record("展开 -> isExpanded + 帧格数", exp is True and cells == multi['n'], f"expanded={exp}, cells={cells}")
        drive(f"window.__sb.collapseAnimated('{sid}')")
        time.sleep(1.0)
        exp2 = ev(rf"(() => {{ return window.__sb.isExpanded('{sid}'); }})()")
        record("折叠 -> isExpanded false", exp2 is False, f"expanded={exp2}")
    else:
        record("展开折叠", False, "无多图镜头可测")

def seg_menu():
    print("\n[4] Menu 右键菜单")
    # 合成 mousedown/mouseup(button=2) 弹菜单（pitfall 241：CDP 真右键会派生 click 立即隐藏）
    # 目标卡片必须滚到视口内（pitfall 15：视口外 elementFromPoint 返回 null = 静默无效）
    rect = ev(r"""(() => {
        const c = document.querySelector('.shot-card');
        if (!c) return null;
        c.scrollIntoView({block: 'center', behavior: 'instant'});
        return 'scrolled';
    })()""")
    time.sleep(0.5)
    rect = ev(r"(() => { const c = document.querySelector('.shot-card'); if (!c) return null; const r = c.getBoundingClientRect(); return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), inView: r.top >= 0 && r.bottom <= window.innerHeight}; })()")
    if not rect or not rect['inView']:
        record("右键菜单弹出", False, f"卡片不在视口内 {rect}")
        return
    drive(rf"""(() => {{
        const el = document.elementFromPoint({rect['x']}, {rect['y']});
        if (!el) return;
        const opts = {{bubbles: true, cancelable: true, button: 2, clientX: {rect['x']}, clientY: {rect['y']}}};
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
    }})()""")
    time.sleep(0.5)
    menu = ev(r"(() => { const m = document.getElementById('contextMenu'); if (!m) return null; const cs = getComputedStyle(m); return cs.display === 'none' ? null : m.innerText; })()")
    # v0.9.14 实测菜单项文本：英文 Open Shot/Rename/Duplicate/Delete + 中文 重拍封面/编辑台词/自动台词大小
    expect = ['Open Shot', '重拍封面', 'Rename', 'Duplicate', 'Delete']
    if menu:
        missing = [e for e in expect if e not in menu]
        record("右键菜单弹出 + 菜单项完整", not missing, f"missing={missing or '无'}")
        # 关闭菜单：menu.js 在 document click 上 hideContextMenu（合成 click 可达主世界）
        drive(r"document.dispatchEvent(new MouseEvent('click', {bubbles: true}))")
        time.sleep(0.3)
        closed = ev(r"(() => { const m = document.getElementById('contextMenu'); return m ? getComputedStyle(m).display === 'none' : true; })()")
        record("菜单外 click 关闭菜单", closed is True, f"closed={closed}")
    else:
        record("右键菜单弹出 + 菜单项完整", False, "菜单未弹出")

def seg_search():
    print("\n[5] Search 搜索")
    shots = api_shots()
    if not shots:
        record("搜索下拉", False, "无镜头")
        return
    kw = shots[0]['name']
    # 搜索 = 下拉结果列表（不过滤卡片！v0.9.14 实测）——合成 input 事件驱动（可达主世界）
    r = ev(rf"""(() => {{
        const i = document.getElementById('searchInput');
        if (!i) return 'NO-INPUT';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(i, '{kw}');
        i.dispatchEvent(new Event('input', {{bubbles: true}}));
        return 'ok';
    }})()""")
    time.sleep(1.0)  # debounce 200ms + 渲染
    st = ev(r"""(() => {
        const r = document.getElementById('searchResults');
        return {
            display: r ? getComputedStyle(r).display : 'NO',
            items: r ? r.querySelectorAll('.search-item').length : -1,
            inputValue: document.getElementById('searchInput').value
        };
    })()""")
    ok = st and st['display'] == 'block' and st['items'] > 0 and st['inputValue'] == kw
    record("搜索输入 -> 下拉结果", ok, f"kw={kw}, display={st and st['display']}, items={st and st['items']}")
    # 清空恢复
    ev(r"""(() => {
        const i = document.getElementById('searchInput');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(i, '');
        i.dispatchEvent(new Event('input', {bubbles: true}));
    })()""")
    time.sleep(0.6)
    st2 = ev(r"(() => { const r = document.getElementById('searchResults'); return r ? getComputedStyle(r).display : 'NO'; })()")
    record("清空搜索下拉隐藏", st2 == 'none', f"display={st2}")

def seg_zoom():
    print("\n[6] Zoom 缩放")
    # __zoomApply 无参（读闭包 cols，传参被忽略）——滑块 sizeSlider 的合成 input 才是驱动入口
    sl = ev(r"""(() => {
        const s = document.getElementById('sizeSlider');
        return s ? {min: Number(s.min), max: Number(s.max), val: Number(s.value)} : null;
    })()""")
    if not sl:
        record("滑块缩放", False, "无 sizeSlider")
        return
    before = ev(r"(() => { return getComputedStyle(document.documentElement).getPropertyValue('--card-min').trim(); })()")
    target = max(sl['min'], sl['val'] - 1)
    ev(rf"""(() => {{
        const s = document.getElementById('sizeSlider');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(s, String({target}));
        s.dispatchEvent(new Event('input', {{bubbles: true}}));
    }})()""")
    time.sleep(1.0)
    after = ev(r"(() => { return getComputedStyle(document.documentElement).getPropertyValue('--card-min').trim(); })()")
    record("滑块缩放 --card-min 变化", after != before, f"{before} -> {after}")
    # 还原原值
    ev(rf"""(() => {{
        const s = document.getElementById('sizeSlider');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(s, String({sl['val']}));
        s.dispatchEvent(new Event('input', {{bubbles: true}}));
    }})()""")
    time.sleep(1.0)
    back = ev(r"(() => { return getComputedStyle(document.documentElement).getPropertyValue('--card-min').trim(); })()")
    record("滑块缩放还原", back == before, f"{after} -> {back}")

def seg_preview():
    print("\n[7] Preview 预览框")
    before = grid_class()
    drive("window.__sb.setPreview(true)")
    time.sleep(1.2)
    cls = grid_class()
    has_preview = 'preview' in cls
    m = ev(r"(() => { const g = document.getElementById('grid'); const cs = getComputedStyle(g); return {l: cs.marginLeft, r: cs.marginRight}; })()")
    record("开预览 -> preview class", has_preview, cls)
    record("开预览 -> grid margin 变化", bool(m) and (m['l'] != '0px' or m['r'] != '0px'), f"marginL={m['l']}, marginR={m['r']}")
    drive("window.__sb.setPreview(false)")
    time.sleep(1.2)
    back = grid_class()
    record("关预览还原", back == before, back)

def seg_dialogue():
    print("\n[8] Dialogue 台词条")
    st = sbs()
    if not st:
        record("台词条", False, "__sb.state 不可读")
        return
    orig_on = bool(st.get('dialogueOn'))
    # 备份 localStorage 并强制开
    bak = ev(r"(() => localStorage.getItem('sb-dialogue-on'))()")
    drive(rf"""(() => {{
        window.__sb.state.dialogueOn = true;
        localStorage.setItem('sb-dialogue-on', '1');
        window.__sb.renderGrid();
    }})()""")
    time.sleep(1.0)
    strips = ev(r"(() => { return document.querySelectorAll('.dialogue-strip').length; })()")
    boxes = ev(r"(() => { return document.querySelectorAll('.dialogue-box').length; })()")
    shots = api_shots()
    with_dlg = sum(1 for s in shots if (s.get('dialogue') or '').strip())
    record("台词条渲染", strips > 0 and boxes > 0, f"strips={strips}, boxes={boxes}, 有台词镜头={with_dlg}")
    record("台词条数 = 有台词镜头数", boxes == with_dlg, f"boxes={boxes}, with_dlg={with_dlg}")
    # 还原
    drive(rf"""(() => {{
        window.__sb.state.dialogueOn = {str(orig_on).lower()};
        if ({'null' if bak is None else repr(bak)}) localStorage.setItem('sb-dialogue-on', {'null' if bak is None else repr(bak)});
        else localStorage.removeItem('sb-dialogue-on');
        window.__sb.renderGrid();
    }})()""")
    time.sleep(1.0)
    record("台词开关还原", sbs().get('dialogueOn') == orig_on, f"dialogueOn={orig_on}")

def seg_keyboard():
    print("\n[9] Keyboard 快捷键")
    # 先解除搜索框焦点（keyboard.js 有 INPUT 门控，聚焦时 Tab/空格全被跳过）
    drive(r"document.activeElement && document.activeElement.blur ? document.activeElement.blur() : null")
    time.sleep(0.3)
    orig = grid_class()
    key_press('Tab', 'Tab')
    time.sleep(0.8)
    cls = grid_class()
    record("Tab 切换视图", cls != orig, f"{orig} -> {cls}")
    key_press('Tab', 'Tab')
    time.sleep(0.8)
    record("Tab 还原", grid_class() == orig, grid_class())
    # 空格展开：先真实点击选中多图镜头（点击前滚动到视口内，pitfall 15），再空格
    multi = find_multi_shot()
    if multi:
        rect = ev(rf"""(() => {{
            const c = document.querySelector('.shot-card[data-id="{multi['id']}"]');
            if (!c) return null;
            c.scrollIntoView({{block: 'center', behavior: 'instant'}});
            return 'scrolled';
        }})()""")
        time.sleep(0.5)
        rect = ev(rf"""(() => {{
            const c = document.querySelector('.shot-card[data-id="{multi['id']}"]');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return {{x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), inView: r.top >= 0 && r.bottom <= window.innerHeight}};
        }})()""")
        if rect and rect['inView']:
            real_click(rect['x'], rect['y'])
            time.sleep(0.5)
            sel = ev(r"(() => { return window.__sb.state.selectedIds.size; })()")
            if sel == 1:
                key_press(' ')
                time.sleep(1.0)
                exp = ev(rf"(() => {{ return window.__sb.isExpanded('{multi['id']}'); }})()")
                record("空格展开选中镜头", exp is True, f"expanded={exp}")
                key_press(' ')
                time.sleep(1.0)
                exp2 = ev(rf"(() => {{ return window.__sb.isExpanded('{multi['id']}'); }})()")
                record("空格折叠还原", exp2 is False, f"expanded={exp2}")
            else:
                record("空格展开选中镜头", False, f"点击后 selectedIds.size={sel}（应=1）")
                record("空格折叠还原", False, "前置失败")
        else:
            record("空格展开选中镜头", False, f"镜头不在视口内 {rect}")
            record("空格折叠还原", False, "前置失败")

SEGS = {
    "render":   (["render", "渲染"], seg_render),
    "view":     (["view", "视图", "列表"], seg_view),
    "expand":   (["expand", "展开", "折叠"], seg_expand),
    "menu":     (["menu", "菜单", "右键"], seg_menu),
    "search":   (["search", "搜索"], seg_search),
    "zoom":     (["zoom", "缩放"], seg_zoom),
    "preview":  (["preview", "预览"], seg_preview),
    "dialogue": (["dialogue", "台词"], seg_dialogue),
    "keyboard": (["keyboard", "键盘", "快捷键"], seg_keyboard),
}

def preflight():
    """前端审计前环境预检：WebBridge 在线 + HTTP 后端在线 + 无测试残留"""
    print('===== 环境预检 =====')
    problems = []
    try:
        st = json.loads(subprocess.run(['curl.exe', '-s', 'http://127.0.0.1:10086/status'],
                                       capture_output=True, text=True, timeout=10).stdout)
        ok = st.get('running') and st.get('extension_connected')
        print(f"  WebBridge daemon: {'OK' if ok else '异常'} ({st.get('extension_connected')})")
        if not ok: problems.append('WebBridge 扩展未连接——先 kimi-webbridge restart')
    except Exception as e:
        print(f'  WebBridge daemon: 失败 {e}')
        problems.append(f'WebBridge 不通: {e}')
    try:
        shots = api_shots()
        print(f'  HTTP 后端 /api/shots: OK（{len(shots)} 镜头）')
    except Exception as e:
        print(f'  HTTP 后端: 失败 {e}')
        problems.append(f'HTTP 后端不通: {e}')
    res = [s['name'] for s in shots if s['name'].startswith(('AUDIT', 'CTX', 'TMP'))]
    if res:
        print(f'  ⚠️ 测试残留: {res}')
        problems.append(f'测试残留 {res}——先清')
    else:
        print('  无测试残留 ✓')
    if problems:
        print('===== 预检失败，不跑审计 =====')
        for p in problems:
            print('  -', p)
        return False
    print('===== 预检通过 =====')
    return True

def restore_all():
    """全局兜底还原：视图/展开/选中/预览/缩放/台词（⚠️ expandedShotIds/selectedIds 是 Set，
    必须 .clear() 不能 =[] 替换——替换会把页面运行时 state 的 Set 变 Array 导致 .has 全炸）"""
    try:
        drive("if (window.__sb) { window.__sb.state.expandedShotIds.clear(); window.__sb.state.selectedIds.clear(); window.__sb.renderGrid(); }")
        drive("if (window.__sb && window.__sb.state.previewOn) window.__sb.setPreview(false)")
        drive("if (window.__zoomApply) window.__zoomApply(1)")
        # 视图还原到宫格
        cls = grid_class()
        if 'list-mode' in (cls or ''):
            drive("window.__sb.toggleView()")
        time.sleep(1.0)
    except Exception as e:
        print(f'  [restore warn] {e}')

def main():
    print("=" * 56)
    print("前端交互审计 (render/view/expand/menu/search/zoom/preview/dialogue/keyboard)")
    print("=" * 56)
    if not preflight():
        return 2
    # 固定 session + 复用标签页（skill pitfall 0/9）
    r = wb('find_tab', {'url': PAGE})
    if not r.get('data', {}).get('tabId'):
        wb('navigate', {'url': PAGE})
    else:
        wb('navigate', {'url': PAGE})
    time.sleep(3)
    # 强制刷新：navigate 到相同 URL 不重载 + 浏览器可能缓存旧 JS（无 ETag/Last-Modified 时
    # no-cache 也会启发式缓存——实测页面跑旧版 state.js，expandedShotIds 是 Array 而非 Set）
    cdp('Network.clearBrowserCache', {})
    cdp('Page.reload', {'ignoreCache': True})
    time.sleep(3)
    # reload 后标签页 active:false → setTimeout/rAF 冻结（pitfall 10b/19），必须解冻
    cdp('Page.bringToFront', {})
    time.sleep(0.5)
    ctor = ev(r"(() => { return window.__sb ? window.__sb.state.expandedShotIds.constructor.name : 'no-sb'; })()")
    if ctor != 'Set':
        print(f'  ⚠️ 页面 JS 版本探针异常：expandedShotIds.constructor={ctor}（应为 Set）——旧缓存 JS？')
        return 1
    drive("if (window.__sb) { window.__sb.state.expandedShotIds.clear(); window.__sb.state.selectedIds.clear(); window.__sb.renderGrid(); }")
    time.sleep(1.0)
    wait_anim()
    ev(r"window.scrollTo(0, 0)")  # 滚动归零（pitfall 15：残留滚动让首行卡片 y 落在标题栏/视口外）

    only = None
    for a in sys.argv[1:]:
        if a.startswith('--only='):
            only = [k.strip().lower() for k in a[7:].split(',') if k.strip()]
    active = [sid for sid in SEGS if not only or
              any(k == sid or any(k in n for n in SEGS[sid][0]) for k in only)]
    if only and not active:
        print(f"--only 未命中任何段。可用：{', '.join(SEGS)}")
        return 1
    if only:
        print(f"[--only] 激活段: {active}")

    for sid in active:
        try:
            SEGS[sid][1]()
        except Exception as e:
            record(sid, False, f"段异常: {e}")

    restore_all()
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
    acquire_lock()
    try:
        sys.exit(main())
    finally:
        if os.path.exists(LOCK):
            os.unlink(LOCK)
