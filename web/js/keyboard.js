// 键盘快捷键：Ctrl+A 全选 / Delete 删除 / Enter 打开 / 空格 展开折叠 / Ctrl+Z 撤销 / 方向键跳格 / Esc 出垃圾桶
import { state } from './state.js';
import { selectAll, deleteSelection, updateSelectionUI } from './selection.js';
import { openShot, undoLast, fetchShots, postShotAction } from './data.js';
import { exitTrashMode } from './trash.js';
import { toast } from './ui.js';
import { isExpanded, expandAnimated, collapseAnimated } from './frames.js';
import { renderGrid } from './render.js';

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

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectAll();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            await undoLast();
        } else if (e.key === 'Escape' && state.trashMode) {
            e.preventDefault();
            exitTrashMode();
        } else if (e.key === 'Delete' && state.selectedIds.size > 0) {
            e.preventDefault();
            // v0.8.2：帧级焦点优先——Delete 删焦点帧而非镜头（蓝框所在的帧）
            const focused = document.querySelector('.frame-img.frame-focused');
            if (focused && state.focusedFrameId) {
                const cell = focused.closest('.shot-card.frame-cell');
                const shotId = cell ? cell.dataset.id : null;
                if (shotId) {
                    const frameNo = focused.dataset.frameNo;
                    await postShotAction(shotId, {action: 'delete_frame', frame_id: state.focusedFrameId});
                    state.focusedFrameId = null;
                    toast(`已删除帧 f${frameNo}`);
                    setTimeout(fetchShots, 1200);
                    return;
                }
            }
            await deleteSelection();
        } else if (e.key === 'Enter' && state.selectedIds.size === 1 && !state.trashMode) {
            e.preventDefault();
            const id = [...state.selectedIds][0];
            openShot(id);
        } else if (e.key === ' ' && state.selectedIds.size === 1 && !state.trashMode) {
            // 空格 = 展开/折叠多图镜头（v0.7.0，与双击同效；v0.8.0 弹簧动效）
            e.preventDefault();  // 阻止页面滚动
            const id = [...state.selectedIds][0];
            const shot = state.shots.find(s => s.id === id);
            if (shot && (shot.frames || []).length > 1) {
                if (isExpanded(id)) collapseAnimated(id);
                else expandAnimated(id);
            }
        } else if (e.key.startsWith('Arrow')) {
            arrowMove(e);
        }
    });
}
