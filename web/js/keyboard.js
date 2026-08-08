// 键盘快捷键：Ctrl+A 全选 / Delete 删除 / Enter 打开 / 空格 展开折叠 / Tab 切换视图 / Ctrl+Z 撤销 / 方向键跳格 / Esc 出垃圾桶
import { state } from './state.js';
import { selectAll, deleteSelection, updateSelectionUI } from './selection.js';
import { openShot, undoLast, fetchShots, postShotAction, postBatch } from './data.js';
import { exitTrashMode } from './trash.js';
import { exitOtherMode } from './other.js';
import { toast } from './ui.js';
import { isExpanded, expandAnimated, collapseAnimated, focusFrame } from './frames.js';
import { renderGrid, toggleView } from './render.js';
import { updatePreview, setPreview } from './preview.js';

// 快捷键清单（唯一事实源：改快捷键必须同步这里——右下角「快捷键」面板用它渲染）
export const SHORTCUTS = [
    { keys: 'Ctrl+A', desc: '全选镜头' },
    { keys: 'Ctrl+Z', desc: '撤销上一步' },
    { keys: 'Ctrl+D', desc: '创建副本（多选时批量复制）' },
    { keys: 'Ctrl+F', desc: '聚焦搜索镜头' },
    { keys: 'Delete', desc: '删除选中镜头（帧蓝框聚焦时删除该帧）' },
    { keys: 'Enter', desc: '打开镜头（选中单个时）' },
    { keys: 'Space', desc: '展开/折叠多图镜头（多选时批量）' },
    { keys: 'Tab', desc: '切换宫格/列表视图' },
    { keys: 'V', desc: '开关预览窗口' },
    { keys: 'Ctrl.+ / Ctrl.-', desc: '放大/缩小（与滚轮/滑块同效）' },
    { keys: '↑↓←→', desc: '移动选择（展开态逐帧格移动）' },
    { keys: 'Shift+方向键', desc: '扩展多选范围' },
    { keys: 'Esc', desc: '退出垃圾桶/其它模式' },
];

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
        state.lastClickId = target.shotId;  // v0.9.4：预览框跟随移动端点
    } else {
        state.selectedIds = new Set([target.shotId]);
        state.anchorId = target.shotId;
        // v0.9.30b：方向键选中折叠态多图 → 焦点落封面帧（与鼠标点击语义一致）
        let fid = target.frameId;
        if (!fid) {
            const _shot = shots.find(s => s.id === target.shotId);
            const _frames = (_shot && _shot.frames) || [];
            if (_frames.length > 1) {
                const _cover = _frames.find(f => f.isCover) || _frames[0];
                fid = _cover ? _cover.id : null;
            }
        }
        state.focusedFrameId = fid;
        focusFrame(target.shotId, fid);  // 同步蓝框（展开态帧格级/折叠态封面级）
        state.lastClickId = target.shotId;  // v0.9.4：预览框跟随移动目标
    }
    updateSelectionUI();
    updatePreview();  // v0.9.4：方向键移动后预览框同步
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
        // v0.9.3：焦点在输入框（搜索栏等）时跳过全部全局快捷键——浏览器默认行为保留
        // （搜索框里按 Delete/空格/方向键/Tab 不该删镜头/展开卡片/跳格/切视图）
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectAll();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            await undoLast();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            // v0.9.23：Ctrl+F 聚焦搜索栏（阻止浏览器页面查找）
            e.preventDefault();
            const si = document.getElementById('searchInput');
            if (si) { si.focus(); si.select(); }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
            // v0.9.23：Ctrl+D 创建副本（阻止浏览器收藏书签）；单选复制 / 多选批量复制；垃圾桶/其它模式禁用
            e.preventDefault();
            if (state.otherMode || state.trashMode || state.selectedIds.size === 0) return;
            const ids = [...state.selectedIds];
            if (ids.length === 1) {
                const r = await postShotAction(ids[0], {action: 'duplicate'});
                if (r && r.status === 'ok') { toast('已排队复制'); setTimeout(fetchShots, 1200); }
                else toast(r && r.message || '操作失败', true);
            } else {
                const r = await postBatch('duplicate', ids);
                if (r && r.status === 'ok') toast(`已排队复制 ${ids.length} 个镜头`);
                else toast(r && r.message || '操作失败', true);
            }
        } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
            // v0.9.18：Ctrl++ 放大（主键盘 = / Shift+= / 数字键盘 +）——阻止浏览器页面缩放
            e.preventDefault();
            if (window.__zoomStep) window.__zoomStep(1);
        } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
            // v0.9.18：Ctrl+- 缩小（主键盘 - / Shift+- / 数字键盘 -）
            e.preventDefault();
            if (window.__zoomStep) window.__zoomStep(-1);
        } else if (e.key === 'Escape' && (state.trashMode || state.otherMode)) {
            e.preventDefault();
            if (state.otherMode) exitOtherMode();
            else exitTrashMode();
        } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // v0.9.3：Tab 切换视图（与 #viewToggle 按钮同效；垃圾桶模式也生效——按钮在垃圾桶页同样可用）
            e.preventDefault();  // 阻止浏览器焦点循环默认行为
            toggleView();
        } else if (e.key === 'Delete' && state.selectedIds.size > 0 && !state.otherMode) {
            e.preventDefault();
            // v0.8.2：帧级焦点优先——Delete 删焦点帧而非镜头（蓝框所在的帧）
            // v0.9.22：宫格 .frame-img 与列表 .frame-thumb 双 class 都匹配——原只查
            // .frame-img.frame-focused，列表展开态蓝框（.frame-thumb.frame-focused）
            // 命中不到 → 直接落到 deleteSelection() 误删整个镜头（真 bug，用户实测确认）
            const focused = document.querySelector('.frame-img.frame-focused, .frame-thumb.frame-focused');
            if (focused && state.focusedFrameId) {
                // 宫格：frame-img 在 .frame-cell 内（data-id=shotId）；
                // 列表：frame-thumb 自带 dataset.shotId（无 .frame-cell 结构）
                const cell = focused.closest('.shot-card.frame-cell');
                const shotId = cell ? cell.dataset.id
                                    : (focused.dataset.shotId || (focused.closest('.shot-card') || {}).dataset.id);
                if (shotId) {
                    const frameNo = focused.dataset.frameNo;
                    const r = await postShotAction(shotId, {action: 'delete_frame', frame_id: state.focusedFrameId});
                    if (r && r.status === 'ok') {
                        state.focusedFrameId = null;
                        toast(`已删除帧 f${frameNo}`);
                        setTimeout(fetchShots, 1200);
                    } else toast(r && r.message || '删除失败', true);
                    return;
                }
            }
            await deleteSelection();
        } else if (e.key === 'Enter' && state.selectedIds.size === 1 && !state.trashMode && !state.otherMode) {
            e.preventDefault();
            const id = [...state.selectedIds][0];
            openShot(id);
        } else if (e.key === ' ' && state.selectedIds.size >= 1 && !state.trashMode && !state.otherMode) {
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
        } else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey && !state.trashMode && !state.otherMode) {
            // v0.9.23：v 开关预览窗口（垃圾桶/其它模式禁用——预览框只服务镜头页）
            e.preventDefault();
            setPreview(!state.previewOn);
        } else if (e.key.startsWith('Arrow') && !state.otherMode) {
            arrowMove(e);
        }
    });
}
