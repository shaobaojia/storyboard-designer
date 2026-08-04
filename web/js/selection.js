// 选择：点选/Ctrl 点选/Shift 范围选/全选/清除 + 删除选中
import { state } from './state.js';
import { askConfirm } from './ui.js';
import { updateStats } from './render.js';
import { fetchShots, postShotAction, postBatch } from './data.js';

export function cardClick(e, shotId) {
    if (e.shiftKey && state.anchorId && state.anchorId !== shotId) {
        // Shift 范围选：锚点 → 点击点按当前排序拉区间 (#7)
        const ids = state.shots.map(s => s.id);
        const a = ids.indexOf(state.anchorId);
        const b = ids.indexOf(shotId);
        if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            const range = ids.slice(lo, hi + 1);
            if (!e.ctrlKey && !e.metaKey) state.selectedIds.clear();
            range.forEach(id => state.selectedIds.add(id));
        }
    } else if (e.ctrlKey || e.metaKey) {
        state.selectedIds.has(shotId) ? state.selectedIds.delete(shotId) : state.selectedIds.add(shotId);
        state.anchorId = shotId;
    } else {
        state.selectedIds.clear();
        state.selectedIds.add(shotId);
        state.anchorId = shotId;
    }
    updateSelectionUI();
}

export function updateSelectionUI() {
    document.querySelectorAll('.shot-card').forEach(c => {
        c.classList.toggle('selected', state.selectedIds.has(c.dataset.id));
    });
    updateStats();
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
    if (!ids.length) return;
    // 垃圾桶模式里 Delete = 彻底删除 (#3)
    if (state.trashMode) {
        if (await askConfirm(`彻底删除 ${ids.length} 个镜头？不可恢复。`)) {
            await postBatch('purge', ids);
            clearSelection();
            fetchShots(true);
        }
        return;
    }
    if (ids.length === 1) {
        const shot = state.shots.find(s => s.id === ids[0]);
        // v0.8.2：软删除不再确认（进垃圾桶可恢复）
        await postShotAction(ids[0], {action: 'delete'});
        state.selectedIds.delete(ids[0]);
        fetchShots();
    } else if (ids.length > 1) {
        // v0.8.2：批量软删除不再确认（进垃圾桶可恢复）
        await postBatch('delete', ids);
        clearSelection();
        fetchShots();
    }
}
