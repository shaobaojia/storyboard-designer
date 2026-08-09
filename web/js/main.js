// 入口：接线所有模块，启动心跳与首次拉取
import { grid, state } from './state.js';
import { syncViewToggleButton, setView, toggleView, showSkeleton, renderGrid, updateStats, initDialogueResize, initDialogueDrag, startDlgEdit, toggleDialogue } from './render.js';
import { fetchShots, heartbeat, loadProjectTitle, openShot, openTimeline, syncScenes } from './data.js';
import { cardClick } from './selection.js';
import { initCardDnd, initFileDrop } from './dnd.js';
import { startRename, startFieldEdit } from './rename.js';
import { initContextMenu } from './menu.js';
import { initCreateModal, openCreateModal } from './create.js';
import { initMarquee } from './marquee.js';
import { initZoom } from './zoom.js';
import { initKeyboard } from './keyboard.js';
import { initTrash, exitTrashMode } from './trash.js';
import { initOther } from './other.js';
import { initSearch } from './search.js';
import { initShortcutsHelp } from './shortcuts.js';
import { initPreview, updatePreview, setPreview, setPreviewW, togglePreviewSide } from './preview.js';
import { initAspect, applyAspect } from './aspect.js';
import { renderTimeline, updateTimelineStage } from './timeline.js';  // v0.9.36：时间线视图
import { isExpanded, expandAnimated, collapseAnimated, jumpToFrame, initStackHover, focusFrame } from './frames.js';
import { ICONS } from './icons.js';

// v0.9.26：图标统一注入——所有 SVG 集中在 icons.js 管理（改颜色 = CSS color/currentColor，
// 改样式 = 改 icons.js 一处）。HTML 里用 <span data-icon="名称"> 占位，这里统一换成 SVG。
// 特殊尺寸：data-icon-class 附加到 svg（如 about-logo 56px）；trash.js 已不重写按钮 innerHTML，注入一次即可。
function mountIcons() {
    document.querySelectorAll('[data-icon]').forEach(el => {
        const body = ICONS[el.dataset.icon];
        if (!body) return;
        el.innerHTML = body;
        if (el.dataset.iconClass) {
            const s = el.querySelector('svg');
            if (s) s.classList.add(el.dataset.iconClass);
        }
    });
}
// ═══ v0.9.27 皮肤系统：主题切换（localStorage 持久化）═══
// 深色 = 默认（:root 变量值），浅色 = [data-theme="light"] 覆盖变量块
const THEME_KEY = 'sb-theme';
function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode */ }
    fillMainMenu();  // 刷新菜单勾选
}
function initTheme() {
    let t = 'dark';
    try { t = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { /* private mode */ }
    document.documentElement.dataset.theme = t;
}
initTheme();

mountIcons();

// ---- 头部按钮 ----
// v0.9.22：宫格/列表拆成两个独立按钮（幂等直切），toggleView 保留给 Tab 快捷键
document.getElementById('viewGridBtn').addEventListener('click', () => setView('grid'));
document.getElementById('viewListBtn').addEventListener('click', () => setView('list'));
document.getElementById('btnCreate').addEventListener('click', openCreateModal);
document.getElementById('btnTimeline').addEventListener('click', openTimeline);

// v0.9.18：右上角主菜单（三条横线图标）——Refresh 移入（原 header 按钮删除）
// v0.9.21：Sync DB 按钮已移除（sync 由自动对账/启动时执行覆盖）
// v0.9.22：Refresh 移除（forceRefresh 函数保留），主菜单只剩「关于」
// v0.9.27：主菜单加「皮肤」小节（深色/浅色，当前项勾选）
const menuBtn = document.getElementById('menuBtn');
const mainMenu = document.getElementById('mainMenu');
// v0.9.35：鼠标点击按钮后立即 blur 不残留焦点——否则下次按键盘快捷键（T/V/Delete 等）
// 会触发浏览器 :focus-visible 启发式，给刚才点过的按钮套默认焦点框（outline）。
// 用 click + e.detail（鼠标点击 detail≥1；键盘 Enter/Space 激活 detail=0）区分输入来源——
// 键盘导航的焦点必须保留（无障碍）。mousedown 里 blur 会被默认聚焦行为抢回，须在 click 后。
document.addEventListener('click', (e) => {
    if (!e.detail) return;  // 键盘/程序触发的 click 不动（保留键盘导航焦点）
    const t = e.target;
    if (t && t.closest) {
        const btn = t.closest('button');
        if (btn && document.activeElement === btn) btn.blur();
    }
}, true);
const fillMainMenu = () => {
    const cur = document.documentElement.dataset.theme || 'dark';
    // v0.9.35：去掉纯文本标题项（主菜单/皮肤）；皮肤做成二级子菜单（hover 展开）并提到关于前面
    mainMenu.innerHTML = `
        <div class="menu-item has-sub">
            <button data-action="theme">皮肤<span class="menu-arrow">›</span></button>
            <div class="sub-menu">
                <button data-action="theme-dark" class="${cur === 'dark' ? 'checked' : ''}">深色</button>
                <button data-action="theme-light" class="${cur === 'light' ? 'checked' : ''}">浅色</button>
            </div>
        </div>
        <button data-action="about" data-tip="版本与项目信息">关于</button>
    `;
};
fillMainMenu();
menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();  // 防 document click 立即关闭
    const show = mainMenu.style.display !== 'block';
    mainMenu.style.display = show ? 'block' : 'none';
    if (show) {
        const r = menuBtn.getBoundingClientRect();
        mainMenu.style.left = Math.max(8, r.right - 160) + 'px';
        mainMenu.style.top = (r.bottom + 6) + 'px';
    }
});
mainMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    mainMenu.style.display = 'none';
    if (btn.dataset.action === 'about') openAbout();
    else if (btn.dataset.action === 'theme-dark') applyTheme('dark');
    else if (btn.dataset.action === 'theme-light') applyTheme('light');
});
document.addEventListener('click', (e) => {
    // 容错：合成事件 dispatch 到 document 时 target 无 closest（AGENTS.md 坑列表）
    const t = e.target;
    if (t && t.closest && !t.closest('#mainMenu') && !t.closest('#menuBtn')) {
        mainMenu.style.display = 'none';
    }
});

// ---- 关于面板（v0.9.22）：主菜单 → 关于 ----
// 版本号 = 产品版本（与 __init__.py bl_info.version 同步，升版时一起改）
// 数据版本 = /api/version 的 "COUNT-rev"（DB 内容版本戳，动态拉取）
const aboutModal = document.getElementById('aboutModal');
function openAbout() {
    fetch('/api/version').then(r => r.json()).then(d => {
        const el = document.getElementById('aboutRev');
        if (el && d && d.version) el.textContent = d.version;
    }).catch(() => {});
    aboutModal.style.display = 'flex';
}
function closeAbout() {
    aboutModal.style.display = 'none';
}
document.getElementById('aboutClose').addEventListener('click', closeAbout);
aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) closeAbout();  // 点遮罩关闭
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aboutModal.style.display !== 'none') closeAbout();
});

// ---- 卡片交互（事件委托）----
grid.addEventListener('click', (e) => {
    const card = e.target.closest('.shot-card');
    if (!card) return;
    // v0.9.25：「其它」页点击 = 选中切换（无 frames/预览/展开语义，走自己的逻辑）
    if (state.otherMode) {
        const sid = card.dataset.id;
        if (state.selectedIds.has(sid)) {
            state.selectedIds.delete(sid);
            card.classList.remove('selected');
        } else {
            state.selectedIds.add(sid);
            card.classList.add('selected');
        }
        updateStats();
        return;
    }
    cardClick(e, card.dataset.id);
    // v0.9.36：时间线 clip 点击 = 纯选中（无折叠按钮/帧焦点语义，跳过 grid 专属逻辑）；
    // updatePreview 不能跳——时间线模式下它转发到顶部预览区（preview.js 内部）
    if (state.viewMode === 'timeline') {
        updatePreview();
        return;
    }
    // 折叠按钮（展开态左上角）
    const collapseBtn = e.target.closest('.collapse-btn');
    if (collapseBtn && card.dataset.id) {
        collapseAnimated(card.dataset.id);
        return;
    }
    // 列表视图展开态帧缩略图：点击=设焦点，双击=跳构图
    const frameThumb = e.target.closest('.frame-thumb');
    if (frameThumb) {
        const sid = frameThumb.dataset.shotId;
        const fid = frameThumb.dataset.frameId;
        focusFrame(sid, fid);
        return;
    }
    // 展开态帧格：点击哪张，焦点蓝框跟到哪张（v0.8.1）
    if (card.classList.contains('frame-cell') && card.dataset.frameId) {
        focusFrame(card.dataset.id, card.dataset.frameId);
    } else {
        // v0.9.30b：点击折叠态多图卡片 → 焦点落封面帧（焦点框盖在封面上）；
        // 单图/无帧镜头保持清焦点（.selected 边框即选中表达）
        const _shot = state.shots.find(s => s.id === card.dataset.id);
        const _frames = (_shot && _shot.frames) || [];
        const _cover = _frames.find(f => f.isCover) || _frames[0];
        if (_frames.length > 1 && _cover) {
            focusFrame(card.dataset.id, _cover.id);
        } else {
            state.focusedFrameId = null;
            grid.querySelectorAll('.frame-img.frame-focused, .frame-thumb.frame-focused, .shot-thumb.frame-focused')
                .forEach(el => el.classList.remove('frame-focused'));
        }
    }
    updatePreview();  // v0.9.4：点击卡片/帧格后预览框跟随（大图 = 焦点帧或封面）
});

grid.addEventListener('dblclick', (e) => {
    // v0.9.36：时间线视图双击 clip 任意处 = 打开镜头（Blender）；时间线无展开/改名语义
    if (state.viewMode === 'timeline') {
        const card = e.target.closest('.shot-card');
        if (card && card.dataset.id) openShot(card.dataset.id);
        return;
    }
    // 双击可编辑单元格（时长/内容/台词）= 就地编辑 (#15)
    const cellEl = e.target.closest('.cell-edit');
    if (cellEl) {
        const card = cellEl.closest('.shot-card');
        if (card) startFieldEdit(e, cellEl, card.dataset.id, cellEl.dataset.field);
        return;
    }
    // 双击名字 = 就地改名
    const nameEl = e.target.closest('.shot-name');
    if (nameEl) {
        const card = nameEl.closest('.shot-card');
        if (card) startRename(e, card.dataset.id);
        return;
    }
    if (e.target.closest('.shot-name-input') || e.target.closest('.field-input')) return;
    const card = e.target.closest('.shot-card');
    if (!card) return;
    const shotId = card.dataset.id;
    const shot = state.shots.find(s => s.id === shotId);

    // 列表视图展开态：双击帧缩略图 = 跳回该构图
    const listThumb = e.target.closest('.frame-thumb');
    if (listThumb) {
        jumpToFrame(listThumb.dataset.shotId, parseInt(listThumb.dataset.frameNo));
        return;
    }
    // 展开态双击某张帧图 = 跳回该构图（v0.7.0）
    const frameImg = e.target.closest('.frame-img');
    if (frameImg && card.classList.contains('frame-cell')) {
        jumpToFrame(shotId, parseInt(frameImg.dataset.frameNo));
        return;
    }

    // 多图镜头：折叠→展开，展开→折叠
    if (shot && (shot.frames || []).length > 1) {
        if (isExpanded(shotId)) collapseAnimated(shotId);
        else expandAnimated(shotId);
        return;
    }

    // 单图镜头：双击 → 在 Blender 中打开该镜头
    openShot(shotId);
});

// ---- 各交互模块 ----
initCardDnd();
initFileDrop();
initContextMenu();
initCreateModal();
initMarquee();
initZoom();
initKeyboard();
initTrash();
initOther();  // 「其它」页（v0.9.25）
// v0.9.25：进「其它」先退垃圾桶（反向互斥在 trash.js initTrash）——先注册先执行
document.getElementById('otherBtn').addEventListener('click', () => {
    // v0.9.35：silent 静默退垃圾桶——马上进其它页，防两个 fetchShots 并发竞态
    //（旧版 exitTrashMode() 与 enterOtherMode() 并发，/api/shots 响应后到会覆盖其它页数据）
    if (state.trashMode) exitTrashMode(true);
});
initSearch();
initShortcutsHelp();
initPreview();
initAspect();  // 画幅比：默认注入 + 对话框接线（v0.9.7）
initDialogueResize();  // 宫格台词条拖拽调宽（v0.9.8）
initDialogueDrag();    // 宫格台词条拖拽移动/互换（v0.9.16）
initDialogueToggle();  // 全局台词开关按钮 + 双击就地编辑委托（v0.9.8）
initStackHover();  // 多图镜头折叠态悬停扫视（v0.7.0）

// e2e 调试句柄：webbridge evaluate 走页面主世界时可直接驱动编排函数
window.__aspectApply = applyAspect;  // loadProjectTitle 拉到项目画幅后调用
window.__sb = { state, renderGrid, expandAnimated, collapseAnimated, isExpanded, toggleView, setView,
    updatePreview, setPreview, setPreviewW, togglePreviewSide,
    renderTimeline, updateTimelineStage,  // v0.9.36：时间线视图调试句柄
    toggleListMulti(shotId) {
        if (isExpanded(shotId)) collapseAnimated(shotId);
        else expandAnimated(shotId);
    }
};

// ---- 宫格台词条：全局开关按钮 + 双击就地编辑委托（v0.9.8）----
function initDialogueToggle() {
    const btn = document.getElementById('dialogueBtn');
    const syncBtn = () => btn.classList.toggle('active-view', state.dialogueOn);
    // v0.9.35：点击走 render.js 的 toggleDialogue（与 T 快捷键共用，锚定逻辑注释在 render.js）
    btn.addEventListener('click', () => toggleDialogue());
    syncBtn();
    // 双击台词框就地编辑（委托：父条/box 是动态 DOM，事件绑 document）
    // v0.9.9：data-dlg-id 移到 .dialogue-box（父条不再带 id），查 box 链
    document.addEventListener('dblclick', (e) => {
        const textEl = e.target.closest('.dialogue-text');
        if (!textEl) return;
        const boxEl = textEl.closest('.dialogue-box');
        if (!boxEl || !boxEl.dataset.dlgId) return;
        startDlgEdit(e, boxEl.dataset.dlgId);
    });
}

// ---- 启动 ----
syncViewToggleButton();
// 画幅变量兜底：aspect.js 模块加载失败也不致画面错乱（保持 16:9，--aspect-h 防帧图高归 0）
document.documentElement.style.setProperty('--aspect', 16 / 9);
document.documentElement.style.setProperty('--aspect-h', 9 / 16);
showSkeleton();  // 骨架屏先铺上，数据到了由 renderGrid 接棒 (#1)
setInterval(heartbeat, 1500);
loadProjectTitle();
fetchShots();
