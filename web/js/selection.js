// 选择：点选/Ctrl 点选/全选/清除 + 删除选中
import { state } from './state.js';
import { askConfirm } from './ui.js';
import { fetchShots, postShotAction, postBatch } from './data.js';

export function cardClick(e, shotId) {
    if (e.ctrlKey || e.metaKey) {
        state.selectedIds.has(shotId) ? state.selectedIds.delete(shotId) : state.selectedIds.add(shotId);
    } else {
        state.selectedIds.clear();
        state.selectedIds.add(shotId);
    }
    updateSelectionUI();
}

export function updateSelectionUI() {
    document.querySelectorAll('.shot-card').forEach(c => {
        c.classList.toggle('selected', state.selectedIds.has(c.dataset.id));
    });
}

export function clearSelection() {
    state.selectedIds.clear();
    updateSelectionUI();
}

export function selectAll() {
    state.selectedIds = new Set(state.shots.map(s => s.id));
    updateSelectionUI();
}

export async function deleteSelection() {
    const ids = [...state.selectedIds];
    if (ids.length === 1) {
        const shot = state.shots.find(s => s.id === ids[0]);
        if (shot && await askConfirm(`删除 ${shot.name}？场景和文件都会移除。`)) {
            await postShotAction(ids[0], {action: 'delete'});
            state.selectedIds.delete(ids[0]);
            fetchShots();
        }
    } else if (ids.length > 1) {
        if (await askConfirm(`批量删除 ${ids.length} 个镜头？场景和文件都会移除。`)) {
            await postBatch('delete', ids);
            clearSelection();
            fetchShots();
        }
    }
}
