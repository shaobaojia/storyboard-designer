// 右键语义（原地松开=菜单，拖动=惯性滑动）+ 右键菜单
import { state } from './state.js';
import { toast, askConfirm } from './ui.js';
import { fetchShots, postShotAction, postBatch, openShot } from './data.js';
import { updateSelectionUI, clearSelection } from './selection.js';
import { startRename } from './rename.js';

// ---- 右键菜单 ----
export function showContextMenu(x, y, shotId) {
    if (!state.selectedIds.has(shotId)) {
        state.selectedIds.clear();
        state.selectedIds.add(shotId);
        updateSelectionUI();
    }
    state.contextShotId = shotId;

    const menu = document.getElementById('contextMenu');
    if (state.selectedIds.size > 1) {
        menu.innerHTML = `
            <div class="menu-title">已选 ${state.selectedIds.size} 个镜头</div>
            <button data-action="batch-duplicate">批量复制</button>
            <button data-action="batch-rerender">批量重渲染</button>
            <button data-action="batch-rename">批量重命名</button>
            <button class="danger" data-action="batch-delete">批量删除</button>
        `;
    } else {
        menu.innerHTML = `
            <button data-action="open">Open Shot</button>
            <button data-action="rerender">Re-render</button>
            <button data-action="rename">Rename</button>
            <button data-action="duplicate">Duplicate</button>
            <button class="danger" data-action="delete">Delete</button>
        `;
    }
    menu.style.display = 'block';
    const mw = 170, mh = menu.offsetHeight || 180;
    menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

export function hideContextMenu() {
    document.getElementById('contextMenu').style.display = 'none';
    state.contextShotId = null;
}

async function menuAction(action) {
    if (!state.contextShotId) return;
    const shotId = state.contextShotId;
    const batchIds = [...state.selectedIds];
    hideContextMenu();

    const shot = state.shots.find(s => s.id === shotId);

    switch (action) {
        case 'open':
            openShot(shotId);
            break;
        case 'rerender':
            await postShotAction(shotId, {action: 'rerender'});
            toast('已排队重渲染');
            break;
        case 'rename':
            startRename(null, shotId);
            break;
        case 'duplicate':
            await postShotAction(shotId, {action: 'duplicate'});
            toast('已排队复制');
            break;
        case 'delete':
            if (shot && await askConfirm(`删除 ${shot.name}？场景和文件都会移除。`)) {
                await postShotAction(shotId, {action: 'delete'});
                state.selectedIds.delete(shotId);
                fetchShots();
            }
            break;
        case 'batch-duplicate':
            await postBatch('duplicate', batchIds);
            toast(`已排队复制 ${batchIds.length} 个镜头`);
            break;
        case 'batch-rerender':
            await postBatch('rerender', batchIds);
            toast(`已排队重渲染 ${batchIds.length} 个镜头`);
            break;
        case 'batch-rename':
            await postBatch('rename_seq', batchIds);
            toast(`已排队重命名 ${batchIds.length} 个镜头（c 系递增）`);
            setTimeout(fetchShots, 1500);
            break;
        case 'batch-delete':
            if (await askConfirm(`批量删除 ${batchIds.length} 个镜头？场景和文件都会移除。`)) {
                await postBatch('delete', batchIds);
                clearSelection();
                fetchShots();
            }
            break;
    }
}

export function initContextMenu() {
    // 菜单按钮用 data-action + 委托（替代原来的 inline onclick）
    const menu = document.getElementById('contextMenu');
    menu.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        e.stopPropagation();
        menuAction(btn.dataset.action);
    });

    document.addEventListener('click', hideContextMenu);

    // 浏览器默认右键菜单全局抑制（镜头菜单由下面的 mouseup 逻辑触发）
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- 右键语义：原地松开=菜单，拖动=惯性滑动 ----
    let rDown = null;

    document.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return;
        if (e.target.closest('.context-menu') || e.target.closest('.modal-overlay') ||
            e.target.closest('.confirm-bar')) return;
        rDown = {
            startX: e.clientX, startY: e.clientY,
            lastX: e.clientX, lastY: e.clientY,
            panning: false,
            card: e.target.closest('.shot-card'),
            samples: [{t: performance.now(), x: e.clientX, y: e.clientY}]
        };
    });

    document.addEventListener('mousemove', (e) => {
        if (!rDown) return;
        const totalDx = e.clientX - rDown.startX;
        const totalDy = e.clientY - rDown.startY;
        if (!rDown.panning && Math.hypot(totalDx, totalDy) > 6) {
            rDown.panning = true;
            state.panning = true;
        }
        if (rDown.panning) {
            window.scrollBy(rDown.lastX - e.clientX, rDown.lastY - e.clientY);
            rDown.samples.push({t: performance.now(), x: e.clientX, y: e.clientY});
            if (rDown.samples.length > 8) rDown.samples.shift();
        }
        rDown.lastX = e.clientX;
        rDown.lastY = e.clientY;
    });

    document.addEventListener('mouseup', (e) => {
        if (e.button !== 2 || !rDown) return;
        const st = rDown;
        rDown = null;
        state.panning = false;

        if (st.panning) {
            // 惯性滑行
            const first = st.samples[0];
            const last = st.samples[st.samples.length - 1];
            const dt = last.t - first.t;
            if (dt > 0 && st.samples.length > 1) {
                let vx = -(last.x - first.x) / dt * 16;
                let vy = -(last.y - first.y) / dt * 16;
                const glide = () => {
                    if (Math.abs(vy) < 0.5 && Math.abs(vx) < 0.5) return;
                    window.scrollBy(vx, vy);
                    vy *= 0.94;
                    vx *= 0.94;
                    requestAnimationFrame(glide);
                };
                requestAnimationFrame(glide);
            }
        } else if (st.card) {
            // 原地松开在卡片上 = 弹镜头菜单
            showContextMenu(e.clientX, e.clientY, st.card.dataset.id);
        }
    });
}
