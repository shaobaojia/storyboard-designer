// 入口：接线所有模块，启动心跳与首次拉取
import { grid } from './state.js';
import { syncViewToggleButton, toggleView } from './render.js';
import { fetchShots, heartbeat, loadProjectTitle, openShot, openTimeline, syncScenes, forceRefresh } from './data.js';
import { cardClick } from './selection.js';
import { initCardDnd, initFileDrop } from './dnd.js';
import { startRename } from './rename.js';
import { initContextMenu } from './menu.js';
import { initCreateModal, openCreateModal } from './create.js';
import { initMarquee } from './marquee.js';
import { initZoom } from './zoom.js';
import { initKeyboard } from './keyboard.js';

// ---- 头部按钮 ----
document.getElementById('viewToggle').addEventListener('click', toggleView);
document.getElementById('btnCreate').addEventListener('click', openCreateModal);
document.getElementById('btnSync').addEventListener('click', syncScenes);
document.getElementById('btnRefresh').addEventListener('click', forceRefresh);
document.getElementById('btnTimeline').addEventListener('click', openTimeline);

// ---- 卡片交互（事件委托）----
grid.addEventListener('click', (e) => {
    const card = e.target.closest('.shot-card');
    if (card) cardClick(e, card.dataset.id);
});

grid.addEventListener('dblclick', (e) => {
    // 双击名字 = 就地改名，双击卡片其他区域 = 打开镜头
    const nameEl = e.target.closest('.shot-name');
    if (nameEl) {
        const card = nameEl.closest('.shot-card');
        if (card) startRename(e, card.dataset.id);
        return;
    }
    if (e.target.closest('.shot-name-input')) return;
    const card = e.target.closest('.shot-card');
    if (card) openShot(card.dataset.id);
});

// ---- 各交互模块 ----
initCardDnd();
initFileDrop();
initContextMenu();
initCreateModal();
initMarquee();
initZoom();
initKeyboard();

// ---- 启动 ----
syncViewToggleButton();
setInterval(heartbeat, 1500);
loadProjectTitle();
fetchShots();
