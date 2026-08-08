// trash.js — 垃圾桶页面模式 (#3)：不是弹窗，是整个页面切到垃圾桶视图
// 宫格/列表/缩放/框选全部复用，只是数据源换成 /api/trash，右键菜单只剩恢复/彻底删除
import { state } from './state.js';
import { fetchShots } from './data.js';
import { clearSelection } from './selection.js';
import { loadProjectTitle } from './data.js';

export async function enterTrashMode() {
    if (state.trashMode) return;
    state.trashMode = true;
    clearSelection();
    document.body.classList.add('trash-mode');
    const btn = document.getElementById('trashBtn');
    // v0.9.24：按钮图标化后不再重写 innerHTML——高亮 + tooltip(data-tip) 区分模式
    btn.classList.add('active-view');
    btn.dataset.tip = '返回宫格/列表';
    await fetchShots(true);  // renderGrid -> updateStats 会同步标题为 垃圾桶 · N
}

export async function exitTrashMode() {
    if (!state.trashMode) return;
    state.trashMode = false;
    clearSelection();
    document.body.classList.remove('trash-mode');
    const btn = document.getElementById('trashBtn');
    btn.classList.remove('active-view');
    btn.dataset.tip = '垃圾桶：查看/恢复已删除的镜头';
    loadProjectTitle();  // 恢复项目名标题
    await fetchShots(true);
}

export function initTrash() {
    document.getElementById('trashBtn').addEventListener('click', () => {
        state.trashMode ? exitTrashMode() : enterTrashMode();
    });
}
