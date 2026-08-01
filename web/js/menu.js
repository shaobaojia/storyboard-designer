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
    if (state.trashMode) {
        // 垃圾桶模式 (#3)：只剩恢复/彻底删除
        menu.innerHTML = state.selectedIds.size > 1
            ? `
            <div class="menu-title">垃圾桶 · 已选 ${state.selectedIds.size} 个</div>
            <button data-action="batch-restore">批量恢复</button>
            <button class="danger" data-action="batch-purge">批量彻底删除</button>
        `
            : `
            <button data-action="restore">恢复</button>
            <button class="danger" data-action="purge">彻底删除</button>
        `;
    } else if (state.selectedIds.size > 1) {
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
            if (shot && await askConfirm(`删除 ${shot.name}？移入垃圾桶，可恢复。`)) {
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
            if (await askConfirm(`批量删除 ${batchIds.length} 个镜头？移入垃圾桶，可恢复。`)) {
                await postBatch('delete', batchIds);
                clearSelection();
                fetchShots();
            }
            break;
        // ---- 垃圾桶模式操作 (#3) ----
        case 'restore':
            await postShotAction(shotId, {action: 'restore'});
            toast(`已恢复 ${shot ? shot.name : ''}`);
            fetchShots(true);
            break;
        case 'purge':
            if (shot && await askConfirm(`彻底删除 ${shot.name}？不可恢复。`)) {
                await postShotAction(shotId, {action: 'purge'});
                state.selectedIds.delete(shotId);
                fetchShots(true);
            }
            break;
        case 'batch-restore':
            await postBatch('restore', batchIds);
            toast(`已恢复 ${batchIds.length} 个镜头`);
            clearSelection();
            fetchShots(true);
            break;
        case 'batch-purge':
            if (await askConfirm(`彻底删除 ${batchIds.length} 个镜头？不可恢复。`)) {
                await postBatch('purge', batchIds);
                clearSelection();
                fetchShots(true);
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

    // ---- 右键/中键语义：原地松开=菜单（仅右键），拖动=惯性滑动，撞墙橡皮筋 ----
    let rDown = null;
    const isPanButton = (e) => e.button === 2 || e.button === 1;  // #4 中键同款

    // 橡皮筋过冲 (#5)：只对 #grid 做 transform，sticky/fixed 元素纹丝不动
    let overshootRaf = null;
    function rubberBand(vy) {
        if (overshootRaf) cancelAnimationFrame(overshootRaf);
        const gridEl = document.getElementById('grid');
        const amp = Math.min(Math.max(Math.abs(vy) * 6, 24), 120);  // 上限 120px
        const dir = vy > 0 ? -1 : 1;  // 向下滚动撞底墙 → 内容向上冲
        const t0 = performance.now();
        const DUR = 520;
        const tick = (t) => {
            const p = Math.min((t - t0) / DUR, 1);
            // 欠阻尼：冲过墙 → 小幅回摆 → 定在墙边
            const f = Math.sin(p * Math.PI * 1.15) * Math.exp(-2.6 * p);
            gridEl.style.transform = `translateY(${dir * amp * f}px)`;
            if (p < 1) {
                overshootRaf = requestAnimationFrame(tick);
            } else {
                gridEl.style.transform = '';
                overshootRaf = null;
            }
        };
        overshootRaf = requestAnimationFrame(tick);
    }

    document.addEventListener('mousedown', (e) => {
        if (!isPanButton(e)) return;
        if (e.target.closest('.context-menu') || e.target.closest('.modal-overlay') ||
            e.target.closest('.confirm-bar')) return;
        if (e.button === 1) e.preventDefault();  // 杀掉浏览器中键自动滚动图标
        // 重新抓取而过冲还在播：立即复位，避免手感粘滞
        if (overshootRaf) {
            cancelAnimationFrame(overshootRaf);
            overshootRaf = null;
            document.getElementById('grid').style.transform = '';
        }
        rDown = {
            button: e.button,
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
        if (!isPanButton(e) || !rDown) return;
        const st = rDown;
        rDown = null;
        state.panning = false;

        if (st.panning) {
            // 惯性滑行 + 橡皮筋过冲 (#5)：撞墙瞬间把剩余速度折算成宫格过冲位移，
            // 欠阻尼弹簧回正——手感是 5→12→10，而不是 5→10→8 弹丢位置
            const first = st.samples[0];
            const last = st.samples[st.samples.length - 1];
            const dt = last.t - first.t;
            if (dt > 0 && st.samples.length > 1) {
                let vx = -(last.x - first.x) / dt * 16;
                let vy = -(last.y - first.y) / dt * 16;
                const glide = () => {
                    if (Math.abs(vy) < 0.5 && Math.abs(vx) < 0.5) return;
                    const sx = window.scrollX, sy = window.scrollY;
                    window.scrollBy(vx, vy);
                    if (window.scrollY === sy && Math.abs(vy) > 4) {
                        rubberBand(vy);  // 撞竖墙：剩余速度转过冲
                        vy = 0;
                    } else if (window.scrollY === sy && Math.abs(vy) >= 0.5) {
                        vy = -vy * 0.35;
                    }
                    if (window.scrollX === sx && Math.abs(vx) >= 0.5) vx = -vx * 0.35;
                    vy *= 0.94;
                    vx *= 0.94;
                    requestAnimationFrame(glide);
                };
                requestAnimationFrame(glide);
            }
        } else if (st.button === 2 && st.card) {
            // 原地松开在卡片上 = 弹镜头菜单（仅右键；中键原地松开无操作）
            showContextMenu(e.clientX, e.clientY, st.card.dataset.id);
        }
    });
}
