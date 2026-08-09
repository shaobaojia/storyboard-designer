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
    // v0.9.27：其它页没有"创建镜头"语义——隐藏新建按钮（退出时恢复）
    document.getElementById('btnCreate').style.display = 'none';
    // v0.9.27：先立即拉数据渲染（秒开，不再硬等 1.5s）——sync 后台触发不等待，
    // 对账完成后 bump rev，1.5s 心跳检测到变化自动刷新（新场景照样自动出现）
    await fetchShots(true);
    try {
        fetch('/api/sync', {method: 'POST'});
    } catch (e) { /* server down, keep quiet */ }
}

export async function exitOtherMode(silent) {
    if (!state.otherMode) return;
    state.otherMode = false;
    clearSelection();
    document.body.classList.remove('other-mode');
    const btn = document.getElementById('otherBtn');
    btn.classList.remove('active-view');
    btn.dataset.tip = '其它：非镜头场景（手动创建/幽灵）';
    // v0.9.27：恢复新建按钮（其它页隐藏的）
    document.getElementById('btnCreate').style.display = '';
    updateStats();
    // v0.9.35：silent = 静默退出（互斥切换用，不拉数据——调用方马上会拉目标视图数据，
    // 两个 fetchShots 并发会竞态：后到的响应按 state 渲染，造成"垃圾桶壳+正常镜头内容"错乱）
    if (!silent) await fetchShots(true);
}

export function initOther() {
    document.getElementById('otherBtn').addEventListener('click', () => {
        state.otherMode ? exitOtherMode() : enterOtherMode();
    });
}
