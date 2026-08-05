// 键盘快捷键：Ctrl+A 全选 / Delete 删除 / Enter 打开 / 空格 展开折叠 / Ctrl+Z 撤销 / 方向键跳格 / Esc 出垃圾桶
import { state } from './state.js';
import { selectAll, deleteSelection, updateSelectionUI } from './selection.js';
import { openShot, undoLast, fetchShots, postShotAction } from './data.js';
import { exitTrashMode } from './trash.js';
import { toast } from './ui.js';
import { isExpanded, expandAnimated, collapseAnimated, focusFrame } from './frames.js';
import { renderGrid } from './render.js';

function gridColumns() {
    if (state.viewMode === 'list') return 1;
    const cols = getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length;
    return Math.max(cols, 1);
}

// 方向键跳格选择 (#1)：左右 ±1，上下 ±列数；Shift 扩展选区
// v0.9.2：展开态多图镜头按帧格粒度移动——格子序列 = 展开镜头的每个帧格占 1 格，
// 折叠/单图镜头占 1 格；落在帧格上时设置 focusedFrameId（蓝框），落在镜头上清空
function arrowMove(e) {
    const shots = state.shots;
    if (!shots.length) return;
    const step = {ArrowLeft: -1, ArrowRight: 1}[e.key] ?? {ArrowUp: -gridColumns(), ArrowDown: gridColumns()}[e.key];

    // 构造格子序列（DOM 视觉顺序 = shots 顺序 + 展开帧格顺序）
    const cells = [];
    shots.forEach(s => {
        const frames = (s.frames || []);
        if (frames.length > 1 && isExpanded(s.id)) {
            frames.forEach(f => cells.push({shotId: s.id, frameId: f.id}));
        } else {
            cells.push({shotId: s.id, frameId: null});
        }
    });

    // 当前光标位置：选中镜头在序列中的起点 + focusedFrameId 偏移到具体帧格
    let cur = -1;
    const curShotId = [...state.selectedIds][0] ?? state.anchorId;
    const startIdx = cells.findIndex(c => c.shotId === curShotId);
    if (startIdx !== -1) {
        cur = startIdx;
        if (state.focusedFrameId) {
            for (let i = startIdx; i < cells.length && cells[i].shotId === curShotId; i++) {
                if (cells[i].frameId === state.focusedFrameId) { cur = i; break; }
            }
        }
    }
    if (cur === -1) cur = step > 0 ? -1 : cells.length;
    const next = Math.min(cells.length - 1, Math.max(0, cur + step));
    if (next === cur && cur !== -1) return;
    const target = cells[next];

    if (e.shiftKey) {
        // Shift+方向键：从锚点扩到新区间端点（镜头级，v0.9.2 保持原逻辑）
        const ids = shots.map(s => s.id);
        const a = ids.indexOf(state.anchorId ?? target.shotId);
        const b = ids.indexOf(target.shotId);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        state.selectedIds = new Set(ids.slice(lo, hi + 1));
        state.focusedFrameId = null;
        focusFrame(null, null);  // 清除蓝框
    } else {
        state.selectedIds = new Set([target.shotId]);
        state.anchorId = target.shotId;
        state.focusedFrameId = target.frameId || null;
        focusFrame(target.shotId, target.frameId || null);  // 同步蓝框（展开态帧格级）
    }
    updateSelectionUI();
    const card = target.frameId
        ? document.querySelector(`.shot-card.frame-cell[data-id="${target.shotId}"][data-frame-id="${target.frameId}"]`)
        : document.querySelector(`.shot-card[data-id="${target.shotId}"]:not(.frame-cell)`);
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
        } else if (e.key === ' ' && state.selectedIds.size >= 1 && !state.trashMode) {
            // 空格 = 展开/折叠多图镜头（单选 v0.7.0，与双击同效；v0.8.0 弹簧动效；
            // v0.9.0 多选批量：全部已展开→全部折叠，否则→全部展开；单图镜头跳过）
            e.preventDefault();  // 阻止页面滚动
            const ids = [...state.selectedIds];
            const multiShots = ids.map(id => state.shots.find(s => s.id === id))
                                  .filter(s => s && (s.frames || []).length > 1);
            if (multiShots.length === 0) return;
            const allExpanded = multiShots.every(s => isExpanded(s.id));
            for (const s of multiShots) {
                if (allExpanded) collapseAnimated(s.id);
                else expandAnimated(s.id);
            }
        } else if (e.key.startsWith('Arrow')) {
            arrowMove(e);
        }
    });
}
