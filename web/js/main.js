// 入口：接线所有模块，启动心跳与首次拉取
import { grid, state } from './state.js';
import { syncViewToggleButton, toggleView, showSkeleton, renderGrid } from './render.js';
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
import { isExpanded, expandAnimated, collapseAnimated, jumpToFrame, initStackHover, focusFrame } from './frames.js';

// ---- 头部按钮 ----
document.getElementById('viewToggle').addEventListener('click', toggleView);
document.getElementById('btnCreate').addEventListener('click', openCreateModal);
document.getElementById('btnSync').addEventListener('click', syncScenes);
document.getElementById('btnRefresh').addEventListener('click', forceRefresh);
document.getElementById('btnTimeline').addEventListener('click', openTimeline);

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
initStackHover();  // 多图镜头折叠态悬停扫视（v0.7.0）

// e2e 调试句柄：webbridge evaluate 走页面主世界时可直接驱动编排函数
window.__sb = { state, renderGrid, expandAnimated, collapseAnimated, isExpanded, toggleView,
    toggleListMulti(shotId) {
        if (isExpanded(shotId)) collapseAnimated(shotId);
        else expandAnimated(shotId);
    }
};

// ---- 启动 ----
syncViewToggleButton();
showSkeleton();  // 骨架屏先铺上，数据到了由 renderGrid 接棒 (#1)
setInterval(heartbeat, 1500);
loadProjectTitle();
fetchShots();
