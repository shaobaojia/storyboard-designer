// 右键语义（原地松开=菜单，拖动=惯性滑动）+ 右键菜单
import { state } from './state.js';
import { toast, askConfirm } from './ui.js';
import { isExpanded, expandAnimated, collapseAnimated } from './frames.js';
import { fetchShots, postShotAction, postBatch, postOtherScene, openShot } from './data.js';
import { updateSelectionUI, clearSelection } from './selection.js';
import { startRename } from './rename.js';
import { startDlgEdit, setDialogueAuto, isDialogueAuto } from './render.js';  // v0.9.11：台词框右键菜单

// ---- 台词框右键菜单（v0.9.11）：编辑 / 自动大小 ----
// v0.9.12：去掉"台词"标题，直接显示功能项
// 自动大小勾选状态 = map 里无该镜头（render.js 语义：无 = 跟随卡片宽）
function showDialogueMenu(x, y, shotId) {
    const auto = isDialogueAuto(shotId);
    const menu = document.getElementById('contextMenu');
    menu.innerHTML = `
        <button data-action="dlg-edit">编辑台词</button>
        <button data-action="dlg-auto">${auto ? '✓ ' : ''}自动大小</button>
    `;
    menu.style.display = 'block';
    const mw = 170, mh = menu.offsetHeight || 120;
    menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

// ---- 右键菜单 ----
export function showContextMenu(x, y, shotId, frameId = null) {
    if (!state.selectedIds.has(shotId)) {
        state.selectedIds.clear();
        state.selectedIds.add(shotId);
        updateSelectionUI();
    }
    state.contextShotId = shotId;
    state.contextFrameId = frameId;  // 帧级菜单：右键点在哪张帧上（v0.7.0）

    const menu = document.getElementById('contextMenu');
    const shot = state.shots.find(s => s.id === shotId);
    const isMulti = shot && (shot.frames || []).length > 1;

    if (state.otherMode) {
        // 「其它」页（v0.9.25）：只剩转为镜头/删除（决策 A1 统一 c 编号 / B1 硬删）
        menu.innerHTML = state.selectedIds.size > 1
            ? `
            <div class="menu-title">已选 ${state.selectedIds.size} 个场景</div>
            <button data-action="other-batch-adopt">批量转为镜头</button>
            <button class="danger" data-action="other-batch-delete">批量删除</button>
        `
            : `
            <div class="menu-title">其它场景</div>
            <button data-action="other-adopt">转为镜头</button>
            <button class="danger" data-action="other-delete">删除场景</button>
        `;
    } else if (state.trashMode) {
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
    } else if (frameId && isMulti && state.selectedIds.size === 1) {
        // 帧级菜单：右键点在展开态的某张帧图上（v0.7.0）。
        // v0.9.2：仅单选时生效——多选状态下所有宫格（含多图展开帧格）统一弹多选菜单
        const frame = shot.frames.find(f => f.id === frameId);
        const coverLabel = frame && frame.isCover ? '✓ 已是封面' : '设为封面';
        menu.innerHTML = `
            <div class="menu-title">帧 ${frame ? 'f' + frame.frame_no : ''}</div>
            <button data-action="toggle-expand">${isExpanded(shotId) ? '折叠' : '展开'}<span class="menu-kbd">Space</span></button>
            <button data-action="frame-cover" ${frame && frame.isCover ? 'disabled' : ''}>${coverLabel}</button>
            <button data-action="frame-rerender">重拍此帧</button>
            <button data-action="frame-jump">跳回构图</button>
            <button class="danger" data-action="frame-delete" ${shot.frames.length <= 1 ? 'disabled' : ''}>删除此张<span class="menu-kbd">Delete</span></button>
            <hr>
            <button data-action="open">打开镜头<span class="menu-kbd">Enter</span></button>
        `;
    } else if (state.selectedIds.size > 1) {
        // 多选菜单：展开/折叠两个独立项（v0.9.1，用户要求批量展开/折叠并存）
        const multiSel = [...state.selectedIds]
            .map(id => state.shots.find(s => s.id === id))
            .filter(s => s && (s.frames || []).length > 1);
        menu.innerHTML = `
            <div class="menu-title">已选 ${state.selectedIds.size} 个镜头</div>
            ${state.viewMode !== 'timeline' && multiSel.length > 0 ? `<button data-action="batch-expand">全部展开</button><button data-action="batch-collapse">全部折叠</button>` : ''}
            <button data-action="batch-duplicate">批量复制<span class="menu-kbd">Ctrl+D</span></button>
            <button data-action="batch-rerender">批量重渲染</button>
            <button data-action="batch-rename">批量重命名</button>
            <button class="danger" data-action="batch-delete">批量删除</button>
        `;
    } else {
        const expanded = isExpanded(shotId);
        const expandLabel = expanded ? '折叠' : '展开';
        // v0.9.12：卡片菜单加台词功能——添加/编辑台词（无台词显示"添加"）+ 自动台词大小勾选
        // v0.9.23/24：列表视图条目菜单去掉全部台词项（台词条只在宫格渲染，列表无台词编辑入口）
        const hasDlg = shot && shot.dialogue && shot.dialogue.trim();
        const isList = state.viewMode === 'list';
        // v0.9.36：时间线视图菜单——无展开语义（clip 不支持展开/折叠），台词编辑保留（时间线有台词轨道）
        const isTimeline = state.viewMode === 'timeline';
        menu.innerHTML = `
            ${isMulti && !isTimeline ? `<button data-action="toggle-expand">${expandLabel}<span class="menu-kbd">Space</span></button>` : ''}
            <button data-action="open">打开镜头<span class="menu-kbd">Enter</span></button>
            <button data-action="rerender">重拍封面</button>
            ${isList || isTimeline ? '' : `
            <button data-action="dlg-edit">${hasDlg ? '编辑台词' : '添加台词'}</button>
            <button data-action="dlg-auto">${isDialogueAuto(shotId) ? '✓ ' : ''}自动台词大小</button>`}
            <button data-action="rename">重命名</button>
            <button data-action="duplicate">复制<span class="menu-kbd">Ctrl+D</span></button>
            <button class="danger" data-action="delete">删除<span class="menu-kbd">Delete</span></button>
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
    state.contextFrameId = null;
}

async function menuAction(action) {
    if (!state.contextShotId) return;
    const shotId = state.contextShotId;
    const frameId = state.contextFrameId;
    const batchIds = [...state.selectedIds];
    hideContextMenu();

    const shot = state.shots.find(s => s.id === shotId);

    // 帧级操作（v0.7.0）：frameId 由右键点击位置带入
    if (frameId && shot) {
        const frame = shot.frames.find(f => f.id === frameId);
        switch (action) {
            case 'frame-cover': {
                const r = await postShotAction(shotId, {action: 'set_cover', frame_id: frameId});
                if (r && r.status === 'ok') { toast('已设为封面'); setTimeout(fetchShots, 1200); }
                else toast(r && r.message || '操作失败', true);
                return;
            }
            case 'frame-rerender': {
                const r = await postShotAction(shotId, {action: 'render_frame', frame_no: frame.frame_no});
                if (r && r.status === 'ok') { toast(`已排队重拍帧 f${frame.frame_no}`); setTimeout(fetchShots, 2500); }
                else toast(r && r.message || '操作失败', true);
                return;
            }
            case 'frame-jump':
                await postShotAction(shotId, {action: 'jump_to_frame', frame_no: frame.frame_no});
                return;
            case 'frame-delete': {
                // v0.8.2：删帧不再确认（软操作，帧可重拍找回）
                const r = await postShotAction(shotId, {action: 'delete_frame', frame_id: frameId});
                if (r && r.status === 'ok') { toast('已删除'); setTimeout(fetchShots, 1200); }
                else toast(r && r.message || '操作失败', true);
                return;
            }
            case 'toggle-expand':
                if (isExpanded(shotId)) collapseAnimated(shotId);
                else expandAnimated(shotId);
                return;
            case 'open':
                openShot(shotId);
                return;
        }
    }

    switch (action) {
        // ---- 台词框菜单（v0.9.11）----
        case 'dlg-edit':
            startDlgEdit(null, shotId);
            break;
        case 'dlg-auto': {
            // 勾选 = 跟随卡片；取消 = 固定当前宽度（setDialogueAuto 内部处理）
            setDialogueAuto(shotId, !isDialogueAuto(shotId));
            // 菜单勾选态即时刷新（菜单还开着）
            const btn = document.querySelector('#contextMenu button[data-action="dlg-auto"]');
            if (btn) btn.textContent = (isDialogueAuto(shotId) ? '✓ ' : '') + '自动大小';
            break;
        }
        case 'toggle-expand':
            if (isExpanded(shotId)) collapseAnimated(shotId);
            else expandAnimated(shotId);
            break;
        case 'open':
            openShot(shotId);
            break;
        case 'rerender': {
            const r = await postShotAction(shotId, {action: 'rerender'});
            if (r && r.status === 'ok') toast('已排队重渲染');
            else toast(r && r.message || '操作失败', true);
            break;
        }
        case 'rename':
            startRename(null, shotId);
            break;
        case 'duplicate': {
            const r = await postShotAction(shotId, {action: 'duplicate'});
            if (r && r.status === 'ok') toast('已排队复制');
            else toast(r && r.message || '操作失败', true);
            break;
        }
        case 'delete': {
            // v0.8.2：软删除不再确认（进垃圾桶可恢复）
            const r = await postShotAction(shotId, {action: 'delete'});
            if (r && r.status === 'ok') { state.selectedIds.delete(shotId); fetchShots(); }
            else toast(r && r.message || '删除失败', true);
            break;
        }
        case 'batch-duplicate': {
            const r = await postBatch('duplicate', batchIds);
            if (r && r.status === 'ok') toast(`已排队复制 ${batchIds.length} 个镜头`);
            else toast(r && r.message || '操作失败', true);
            break;
        }
        case 'batch-expand':
            // v0.9.0 多选批量展开：只展开未展开的多图镜头（v0.9.1 与 batch-collapse 独立并存）
            {
                const multiSel = batchIds.map(id => state.shots.find(s => s.id === id))
                                         .filter(s => s && (s.frames || []).length > 1);
                for (const s of multiSel) {
                    if (!isExpanded(s.id)) expandAnimated(s.id);
                }
            }
            break;
        case 'batch-collapse':
            // v0.9.1 多选批量折叠：只折叠已展开的多图镜头
            {
                const multiSel = batchIds.map(id => state.shots.find(s => s.id === id))
                                         .filter(s => s && (s.frames || []).length > 1);
                for (const s of multiSel) {
                    if (isExpanded(s.id)) collapseAnimated(s.id);
                }
            }
            break;
        case 'batch-rerender': {
            const r = await postBatch('rerender', batchIds);
            if (r && r.status === 'ok') toast(`已排队重渲染 ${batchIds.length} 个镜头`);
            else toast(r && r.message || '操作失败', true);
            break;
        }
        case 'batch-rename': {
            const r = await postBatch('rename_seq', batchIds);
            if (r && r.status === 'ok') { toast(`已排队重命名 ${batchIds.length} 个镜头（c 系递增）`); setTimeout(fetchShots, 1500); }
            else toast(r && r.message || '操作失败', true);
            break;
        }
        case 'batch-delete': {
            // v0.8.2：批量软删除不再确认（进垃圾桶可恢复）
            const r = await postBatch('delete', batchIds);
            if (r && r.status === 'ok') { toast(`已删除 ${batchIds.length} 个镜头（垃圾桶可恢复）`); clearSelection(); fetchShots(); }
            else toast(r && r.message || '删除失败', true);
            break;
        }
        // ---- 垃圾桶模式操作 (#3) ----
        case 'restore': {
            const r = await postShotAction(shotId, {action: 'restore'});
            if (r && r.status === 'ok') { toast(`已恢复 ${shot ? shot.name : ''}`); fetchShots(true); }
            else toast(r && r.message || '恢复失败', true);
            break;
        }
        case 'purge':
            if (shot && await askConfirm(`彻底删除 ${shot.name}？不可恢复。`)) {
                const r = await postShotAction(shotId, {action: 'purge'});
                if (r && r.status === 'ok') { state.selectedIds.delete(shotId); fetchShots(true); }
                else toast(r && r.message || '删除失败', true);
            }
            break;
        case 'batch-restore': {
            const r = await postBatch('restore', batchIds);
            if (r && r.status === 'ok') { toast(`已恢复 ${batchIds.length} 个镜头`); clearSelection(); fetchShots(true); }
            else toast(r && r.message || '恢复失败', true);
            break;
        }
        case 'batch-purge':
            if (await askConfirm(`彻底删除 ${batchIds.length} 个镜头？不可恢复。`)) {
                const r = await postBatch('purge', batchIds);
                if (r && r.status === 'ok') { clearSelection(); fetchShots(true); }
                else toast(r && r.message || '删除失败', true);
            }
            break;
        // ---- 「其它」页操作（v0.9.25）：转为镜头 / 删除 ----
        case 'other-adopt': {
            const r = await postOtherScene(shot.scene_name, {action: 'adopt'});
            if (r && r.status === 'ok') {
                toast(`已转为镜头 ${r.new_name || ''}`);
                state.selectedIds.delete(shotId);
                setTimeout(() => fetchShots(true), 1500);  // 等拍屏队列落地
            } else toast(r && r.message || '操作失败', true);
            break;
        }
        case 'other-delete': {
            if (await askConfirm(`删除场景「${shot.name}」？不可恢复。`)) {
                const r = await postOtherScene(shot.scene_name, {action: 'delete'});
                if (r && r.status === 'ok') { toast('已删除'); state.selectedIds.delete(shotId); fetchShots(true); }
                else toast(r && r.message || '删除失败', true);
            }
            break;
        }
        case 'other-batch-adopt': {
            const scenes = [...state.selectedIds].map(id => state.shots.find(s => s.id === id)).filter(Boolean);
            let ok = 0;
            for (const s of scenes) {
                const r = await postOtherScene(s.scene_name, {action: 'adopt'});
                if (r && r.status === 'ok') ok++;
            }
            toast(`已排队转为镜头 ${ok}/${scenes.length}`);
            clearSelection();
            setTimeout(() => fetchShots(true), 2000);
            break;
        }
        case 'other-batch-delete': {
            if (await askConfirm(`删除 ${batchIds.length} 个场景？不可恢复。`)) {
                const scenes = [...state.selectedIds].map(id => state.shots.find(s => s.id === id)).filter(Boolean);
                for (const s of scenes) await postOtherScene(s.scene_name, {action: 'delete'});
                toast('已排队删除');
                clearSelection();
                fetchShots(true);
            }
            break;
        }
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

    // ---- 右键/中键语义：原地松开=菜单（仅右键），拖动=惯性滑动 + iPhone 跟手橡皮筋 ----
    let rDown = null;
    const isPanButton = (e) => e.button === 2 || e.button === 1;  // #4 中键同款

    // 橡皮筋物理 (#5)：过冲量 ov 是唯一状态，拖动/惯性/弹簧都读写它。
    // 拖动全程跟手：撞墙方向吃 0.45 阻力，回拉方向 1:1 先消过冲再滚动；
    // 松手/惯性撞墙进入欠阻尼弹簧（5→12→10 冲线感），手指再按下立即从当前位置接手。
    let glideRaf = null;
    let springRaf = null;
    let ov = 0;      // 竖向过冲位移 px（>0 内容被拉向下，<0 向上）
    let ovVel = 0;   // 过冲速度 px/帧
    const OV_MAX = 160;
    const RESIST = 0.45;  // 撞墙方向阻力系数

    function applyOv() {
        const el = document.getElementById('grid');
        el.style.transform = ov ? `translateY(${ov}px)` : '';
    }
    // 取消滑行/弹簧动画；keepOv=true 时保留当前过冲位置（重新按住 = 从当前位置接手）
    function cancelMotion(keepOv) {
        if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = null; }
        if (springRaf) { cancelAnimationFrame(springRaf); springRaf = null; }
        if (!keepOv) { ov = 0; ovVel = 0; applyOv(); }
    }
    // 欠阻尼弹簧回正：自然缓出，无生硬截断，可被 mousedown 随时打断
    function startSpring(initVel) {
        if (typeof initVel === 'number') ovVel = initVel;
        if (springRaf) cancelAnimationFrame(springRaf);
        let lastT = performance.now();
        const step = (t) => {
            const dt = Math.min((t - lastT) / 16.67, 3);
            lastT = t;
            ovVel += -ov * 0.14 * dt;      // 弹簧拉力
            ovVel *= Math.pow(0.70, dt);   // 阻尼（加狠了：只许回弹一下 #R6-4）
            const prevOv = ov;
            ov += ovVel * dt;
            if (prevOv !== 0 && Math.sign(ov) !== Math.sign(prevOv)) {
                // 第一次过墙即落定——不 oscillate，回弹一下就够 (#R6-4)
                ov = 0; ovVel = 0; applyOv();
                springRaf = null;
                return;
            }
            if (Math.abs(ov) < 0.4 && Math.abs(ovVel) < 0.4) {
                ov = 0; ovVel = 0; applyOv();
                springRaf = null;
                return;
            }
            applyOv();
            springRaf = requestAnimationFrame(step);
        };
        springRaf = requestAnimationFrame(step);
    }

    document.addEventListener('mousedown', (e) => {
        if (!isPanButton(e)) return;
        if (e.target.closest('.context-menu') || e.target.closest('.modal-overlay') ||
            e.target.closest('.confirm-bar')) return;
        if (e.button === 1) e.preventDefault();  // 杀掉浏览器中键自动滚动图标
        // 惯性/弹簧还在播：取消动画但保留过冲位置，手指从当前位置无缝接手
        cancelMotion(true);
        rDown = {
            button: e.button,
            startX: e.clientX, startY: e.clientY,
            lastX: e.clientX, lastY: e.clientY,
            panning: false,
            card: e.target.closest('.shot-card'),
            dlgBox: e.target.closest('.dialogue-box'),  // v0.9.11：台词框右键（不在卡片内）
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
            const dx = rDown.lastX - e.clientX;
            let dy = rDown.lastY - e.clientY;
            if (ov !== 0) {
                // 过冲态：回拉方向 1:1 先消过冲，同向继续推墙才吃阻力
                const delta = -dy;  // 手指方向 → 内容位移方向
                if (Math.sign(delta) === Math.sign(ov)) {
                    ov = Math.max(-OV_MAX, Math.min(OV_MAX, ov + delta * RESIST));
                    dy = 0;
                } else {
                    const newOv = ov + delta;
                    if (newOv === 0 || Math.sign(newOv) !== Math.sign(ov)) {
                        ov = 0;
                        dy = -newOv;  // 消完过冲的剩余量继续滚动
                    } else {
                        ov = newOv;
                        dy = 0;
                    }
                }
                ovVel = 0;
                applyOv();
            }
            if (dx || dy) {
                const sy = window.scrollY;
                window.scrollBy(dx, dy);
                if (window.scrollY === sy && dy) {
                    // 撞墙：滚动量按阻力转成过冲，内容跟手冲出去
                    ov = Math.max(-OV_MAX, Math.min(OV_MAX, ov - dy * RESIST));
                    ovVel = 0;
                    applyOv();
                }
            }
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
            if (ov !== 0) {
                // 松手时还在过冲态：弹簧从当前位置拉回，随时可被打断接手
                startSpring(0);
                return;
            }
            // 惯性滑行：撞墙瞬间把剩余速度折算成过冲初速，冲线后交棒给弹簧
            const first = st.samples[0];
            const last = st.samples[st.samples.length - 1];
            const dt = last.t - first.t;
            if (dt > 0 && st.samples.length > 1) {
                let vx = -(last.x - first.x) / dt * 16;
                let vy = -(last.y - first.y) / dt * 16;
                const glide = () => {
                    if (Math.abs(vy) < 0.5 && Math.abs(vx) < 0.5) { glideRaf = null; return; }
                    const sx = window.scrollX, sy = window.scrollY;
                    window.scrollBy(vx, vy);
                    if (window.scrollY === sy && Math.abs(vy) > 2) {
                        // 撞竖墙：剩余速度变过冲初速（内容反向冲线），交棒弹簧
                        startSpring(-vy * 0.55);
                        glideRaf = null;
                        return;
                    }
                    if (window.scrollX === sx && Math.abs(vx) >= 0.5) vx = -vx * 0.35;
                    vy *= 0.94;
                    vx *= 0.94;
                    glideRaf = requestAnimationFrame(glide);
                };
                glideRaf = requestAnimationFrame(glide);
            }
        } else if (st.button === 2 && st.dlgBox) {
            // v0.9.11：台词框右键菜单（台词框不在卡片内，st.card 为空，单独分支）
            const shotId = st.dlgBox.dataset.dlgId;
            state.contextShotId = shotId;   // menuAction 依赖 contextShotId
            state.contextFrameId = null;
            showDialogueMenu(e.clientX, e.clientY, shotId);
        } else if (st.button === 2 && st.card) {
            // 原地松开在卡片上 = 弹镜头菜单（仅右键；中键原地松开无操作）
            // 点在展开态帧图上 → 帧级菜单（v0.7.0）。折叠态多图是一叠牌，
            // 帧图叠放在卡片上，若不管展开态直接 closest('.frame-img')，
            // 折叠态右键会误弹帧级菜单——必须只在展开态生效（v0.8.2）。
            // 列表展开态帧图 class 是 .frame-thumb（render.js），一并匹配（v0.8.2）
            const shotId = st.card.dataset.id;
            const frameImg = isExpanded(shotId) ? e.target.closest('.frame-img, .frame-thumb') : null;
            const frameId = frameImg ? frameImg.dataset.frameId : null;
            showContextMenu(e.clientX, e.clientY, shotId, frameId);
        }
    });
}
