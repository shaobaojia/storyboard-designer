// 键盘快捷键：Ctrl+A 全选 / Delete 删除 / Enter 打开 / Ctrl+Z 撤销 / 方向键跳格
import { state } from './state.js';
import { selectAll, deleteSelection, updateSelectionUI } from './selection.js';
import { openShot, undoLast } from './data.js';
import { toast } from './ui.js';

function gridColumns() {
    if (state.viewMode === 'list') return 1;
    const cols = getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length;
    return Math.max(cols, 1);
}

// 方向键跳格选择 (#1)：左右 ±1，上下 ±列数；Shift 扩展选区
function arrowMove(e) {
    const shots = state.shots;
    if (!shots.length) return;
    const step = {ArrowLeft: -1, ArrowRight: 1}[e.key] ?? {ArrowUp: -gridColumns(), ArrowDown: gridColumns()}[e.key];

    const ids = shots.map(s => s.id);
    // 基准点：单选取选中项，否则取锚点，都没有则从边界开始
    let cur = ids.indexOf([...state.selectedIds][0] ?? state.anchorId);
    if (cur === -1) cur = step > 0 ? -1 : ids.length;
    const next = Math.min(ids.length - 1, Math.max(0, cur + step));
    if (next === cur && cur !== -1) return;
    const nextId = ids[next];

    if (e.shiftKey) {
        // Shift+方向键：从锚点扩到新区间端点
        const a = ids.indexOf(state.anchorId ?? nextId);
        const [lo, hi] = a < next ? [a, next] : [next, a];
        state.selectedIds = new Set(ids.slice(lo, hi + 1));
    } else {
        state.selectedIds = new Set([nextId]);
        state.anchorId = nextId;
    }
    updateSelectionUI();
    const card = document.querySelector(`.shot-card[data-id="${nextId}"]`);
    if (card) card.scrollIntoView({block: 'nearest'});
    e.preventDefault();
}

export function initKeyboard() {
    document.addEventListener('keydown', async (e) => {
        if (state.editingId) return;
        if (document.getElementById('createModal').style.display === 'flex') return;
        if (document.getElementById('trashModal').style.display === 'flex') return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectAll();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            await undoLast();
        } else if (e.key === 'Delete' && state.selectedIds.size > 0) {
            e.preventDefault();
            await deleteSelection();
        } else if (e.key === 'Enter' && state.selectedIds.size === 1) {
            e.preventDefault();
            const id = [...state.selectedIds][0];
            openShot(id);
        } else if (e.key.startsWith('Arrow')) {
            arrowMove(e);
        }
    });
}
