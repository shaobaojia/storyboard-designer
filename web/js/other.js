// other.js — 「其它」页面模式（v0.9.25）：非镜头场景（手动创建/幽灵/其它途径）
// 仿垃圾桶（trash.js）整页切换模式：body class + 按钮高亮 + 数据源换 /api/other_scenes。
// 卡片渲染在 render.js 的 renderOtherGrid（简化卡片：场景名+相机），右键菜单只剩转为镜头/删除。
import { state } from './state.js';
import { fetchShots } from './data.js';
import { clearSelection } from './selection.js';
import { updateStats } from './render.js';

export async function enterOtherMode() {
    if (state.otherMode) return;
    state.otherMode = true;
    clearSelection();
    document.body.classList.add('other-mode');
    const btn = document.getElementById('otherBtn');
    btn.classList.add('active-view');
    btn.dataset.tip = '返回宫格/列表';
    // 先触发一次完整 sync（立即对账，不用等 5s 心跳），再拉数据
    try {
        await fetch('/api/sync', {method: 'POST'});
    } catch (e) { /* server down, keep quiet */ }
    await new Promise(r => setTimeout(r, 1500));
    await fetchShots(true);
}

export async function exitOtherMode() {
    if (!state.otherMode) return;
    state.otherMode = false;
    clearSelection();
    document.body.classList.remove('other-mode');
    const btn = document.getElementById('otherBtn');
    btn.classList.remove('active-view');
    btn.dataset.tip = '其它：非镜头场景（手动创建/幽灵）';
    updateStats();
    await fetchShots(true);
}

export function initOther() {
    document.getElementById('otherBtn').addEventListener('click', () => {
        state.otherMode ? exitOtherMode() : enterOtherMode();
    });
}
