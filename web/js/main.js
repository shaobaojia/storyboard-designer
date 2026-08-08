// 入口：接线所有模块，启动心跳与首次拉取
import { grid, state } from './state.js';
import { syncViewToggleButton, toggleView, showSkeleton, renderGrid, initDialogueResize, initDialogueDrag, startDlgEdit } from './render.js';
import { fetchShots, heartbeat, loadProjectTitle, openShot, openTimeline, syncScenes, forceRefresh } from './data.js';
import { cardClick } from './selection.js';
import { initCardDnd, initFileDrop } from './dnd.js';
import { startRename, startFieldEdit } from './rename.js';
import { initContextMenu } from './menu.js';
import { initCreateModal, openCreateModal } from './create.js';
import { initMarquee } from './marquee.js';
import { initZoom } from './zoom.js';
import { initKeyboard } from './keyboard.js';
import { initTrash } from './trash.js';
import { initSearch } from './search.js';
import { initShortcutsHelp } from './shortcuts.js';
import { initPreview, updatePreview, setPreview, setPreviewW, togglePreviewSide } from './preview.js';
import { initAspect, applyAspect } from './aspect.js';
import { isExpanded, expandAnimated, collapseAnimated, jumpToFrame, initStackHover, focusFrame } from './frames.js';

// ---- 头部按钮 ----
document.getElementById('viewToggle').addEventListener('click', toggleView);
document.getElementById('btnCreate').addEventListener('click', openCreateModal);
document.getElementById('btnTimeline').addEventListener('click', openTimeline);

// v0.9.18：右上角主菜单（三条横线图标）——Refresh 移入（原 header 按钮删除）
// v0.9.21：Sync DB 按钮已移除（sync 由自动对账/启动时执行覆盖）
const menuBtn = document.getElementById('menuBtn');
const mainMenu = document.getElementById('mainMenu');
const fillMainMenu = () => {
    mainMenu.innerHTML = `
        <div class="menu-title">主菜单</div>
        <button data-action="refresh">Refresh</button>
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
    if (btn.dataset.action === 'refresh') forceRefresh();
});
document.addEventListener('click', (e) => {
    // 容错：合成事件 dispatch 到 document 时 target 无 closest（AGENTS.md 坑列表）
    const t = e.target;
    if (t && t.closest && !t.closest('#mainMenu') && !t.closest('#menuBtn')) {
        mainMenu.style.display = 'none';
    }
});

// ---- 卡片交互（事件委托）----
grid.addEventListener('click', (e) => {
    const card = e.target.closest('.shot-card');
    if (!card) return;
    cardClick(e, card.dataset.id);
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
        // 点击非帧格卡片：清除所有帧焦点，避免残留蓝框（v0.9.2 含列表 frame-thumb）
        state.focusedFrameId = null;
        grid.querySelectorAll('.frame-img.frame-focused, .frame-thumb.frame-focused')
            .forEach(el => el.classList.remove('frame-focused'));
    }
    updatePreview();  // v0.9.4：点击卡片/帧格后预览框跟随（大图 = 焦点帧或封面）
});

grid.addEventListener('dblclick', (e) => {
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
window.__sb = { state, renderGrid, expandAnimated, collapseAnimated, isExpanded, toggleView,
    updatePreview, setPreview, setPreviewW, togglePreviewSide,
    toggleListMulti(shotId) {
        if (isExpanded(shotId)) collapseAnimated(shotId);
        else expandAnimated(shotId);
    }
};

// ---- 宫格台词条：全局开关按钮 + 双击就地编辑委托（v0.9.8）----
function initDialogueToggle() {
    const btn = document.getElementById('dialogueBtn');
    const syncBtn = () => btn.classList.toggle('active-view', state.dialogueOn);
    // v0.9.17：开关台词以选中镜头为中心锚定（同缩放语义，zoom.js v0.9.2）。
    // FLIP 播放中 getBoundingClientRect 含 transform（起点补偿位移动画），恢复必须用
    // offsetTop（布局值免疫 transform）：target = grid 文档 top + 镜头新 offsetTop + 半高
    // - 视口半高 - 开关前相对偏移。FLIP 起点=旧视口位置、终点=新视口位置（=旧 rel）
    // → 动画全程焦点镜头钉在原位，周围卡片围绕它 FLIP，正是"以焦点镜头为中心"。
    const anchorDlg = () => {
        if (!state.selectedIds || state.selectedIds.size === 0) return null;
        const id = [...state.selectedIds][0];
        const sel = grid.querySelector(`.shot-card[data-id="${id}"]`);
        if (!sel) return null;
        const r = sel.getBoundingClientRect();  // 开关前无 FLIP，视口坐标准确
        return { id, rel: r.top + r.height / 2 - window.innerHeight / 2,
                 gridDocTop: grid.getBoundingClientRect().top + window.scrollY };
    };
    // v0.9.18：滚动逻辑已挪进 renderGrid（state.pendingAnchor，FLIP 前滚动）——
    // 原来 renderGrid 返回后 scrollTo 与 FLIP transform 同帧叠加，起点帧焦点不在原位
    // （页面末尾镜头开关台词上下抖，实测 ±476px）。见 render.js pendingAnchor 块。
    btn.addEventListener('click', () => {
        const a = anchorDlg();
        state.dialogueOn = !state.dialogueOn;
        localStorage.setItem('sb-dialogue-on', state.dialogueOn ? '1' : '0');
        syncBtn();
        state.pendingAnchor = a;
        renderGrid();
    });
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
