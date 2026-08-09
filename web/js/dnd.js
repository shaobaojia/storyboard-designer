// 卡片拖拽排序（支持整组移动）+ 拖图分区（卡片区/新建区）
import { state, grid } from './state.js';
import { renderGrid } from './render.js';
import { toast } from './ui.js';
import { fetchShots } from './data.js';

export function isFileDrag(e) {
    if (!e.dataTransfer) return false;
    const types = [...e.dataTransfer.types];
    // 内部卡片拖拽带 text/x-shot-id 标记，永远不算文件拖拽
    return types.includes('Files') && !types.includes('text/x-shot-id');
}

// v0.9.5：pos = 'before' | 'after' 显式插入位置（配合插入指示线——宫格竖线/列表横线
// 指示"插到该卡前/后"）；原语义是"替换 dst 位置"，现由拖拽半区判定显式决定
async function reorderShots(srcId, dstId, pos = 'before') {
    const shots = state.shots;
    const srcIdx = shots.findIndex(s => s.id === srcId);
    const dstIdx = shots.findIndex(s => s.id === dstId);
    if (srcIdx === -1 || dstIdx === -1) return;

    let movingIds;
    if (state.selectedIds.has(srcId) && state.selectedIds.size > 1) {
        movingIds = shots.filter(s => state.selectedIds.has(s.id)).map(s => s.id);
    } else {
        movingIds = [srcId];
    }
    if (movingIds.includes(dstId)) return;  // 落点在自己组内 = 无操作（v0.8.1，曾把整组排到末尾）

    const moving = shots.filter(s => movingIds.includes(s.id));
    const rest = shots.filter(s => !movingIds.includes(s.id));
    const insertIdx = rest.findIndex(s => s.id === dstId);
    const at = insertIdx === -1 ? rest.length : (pos === 'after' ? insertIdx + 1 : insertIdx);
    rest.splice(at, 0, ...moving);
    const oldShots = state.shots;  // v0.9.6：保存旧顺序，失败回滚
    state.shots = rest;

    try {
        const res = await fetch('/api/reorder', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({shot_ids: state.shots.map(s => s.id)})
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);  // v0.9.6：500 也当失败
    } catch (e) {
        console.error('Reorder failed:', e);
        state.shots = oldShots;  // v0.9.6：回滚本地顺序，与服务端保持一致
        renderGrid();
        return;
    }
    renderGrid();  // FLIP 动效在 renderGrid 内部处理
}

// ---- 卡片拖拽（grid 委托）----
// v0.9.5：虚线框 → 插入位置指示线（宫格=竖线插左/右，列表=横线插上/下），
// 按鼠标在目标卡上的半区判定插入方向，drop 时按方向显式插入
const dropIndicator = document.createElement('div');
dropIndicator.className = 'drop-indicator';
document.body.appendChild(dropIndicator);

function hideDropIndicator() {
    dropIndicator.style.display = 'none';
}

// v0.9.18：指针落在卡片间隙（宫格列 gap 12px / 列表条目间距）时 elementFromPoint 命中不了
// 卡片 → 指示线消失（用户实测拖到两镜中间竖线/横线消失）。几何兜底：找指针最近的非源卡，
// 距离 ≤ 阈值视为"间隙命中"，指示线照常显示（线位置本就设计在 gap 中央 rect.left-7/right+5）。
const GAP_HIT_MAX = 24;  // 间隙场景距离 ~6px，空白区远超此值不误触发
function nearestCard(x, y, exclude) {
    let best = null, bestD = GAP_HIT_MAX * GAP_HIT_MAX;
    document.querySelectorAll('.shot-card').forEach(c => {
        if (exclude && c === exclude) return;
        const r = c.getBoundingClientRect();
        const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
        const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = c; }
    });
    return best;
}

function updateDropIndicator(card, e, cx, cy) {
    const rect = card.getBoundingClientRect();
    const isList = state.viewMode === 'list';
    // cx/cy 为坐标覆盖（pointercancel 无有效坐标时用最后 move 位置）
    const x = cx !== undefined ? cx : e.clientX;
    const y = cy !== undefined ? cy : e.clientY;
    if (isList) {
        // 列表：横线，插上（before）/ 插下（after）
        const before = y < rect.top + rect.height / 2;
        dropIndicator.className = 'drop-indicator horizontal';
        dropIndicator.style.width = (rect.width - 8) + 'px';
        dropIndicator.style.height = '';   // 清竖线残留（视图切换后 inline 尺寸残留会撑成大蓝块）
        dropIndicator.style.left = (rect.left + 4) + 'px';
        dropIndicator.style.top = (before ? rect.top - 4 : rect.bottom + 1) + 'px';
        card.dataset.dropPos = before ? 'before' : 'after';
    } else {
        // 宫格：竖线，插左（before）/ 插右（after）；gap 12px → 线落在两卡间隙中央
        const before = x < rect.left + rect.width / 2;
        dropIndicator.className = 'drop-indicator vertical';
        dropIndicator.style.width = '';    // 清横线残留
        dropIndicator.style.height = (rect.height - 8) + 'px';
        dropIndicator.style.top = (rect.top + 4) + 'px';
        dropIndicator.style.left = (before ? rect.left - 7 : rect.right + 5) + 'px';
        card.dataset.dropPos = before ? 'before' : 'after';
    }
    dropIndicator.style.display = 'block';
}

export function initCardDnd() {
    // v0.9.5：HTML5 DnD → Pointer Events 自定义拖拽。原因：浏览器 DnD 光标无法自定义
    // （dropEffect='move' 带虚线小方块；dragover 节流丢失时间隙闪 no-drop），用户要求
    // 拖拽全程默认光标。自定义实现：指针全程 CSS default、无 ghost 方块、无 no-drop
    // 闪烁；源卡 transform 跟随（拖拽反馈），落点 elementFromPoint 命中检测 + 半区判定。
    // 外部文件拖入仍走原生 DnD（initFileDrop 不受影响）。
    let drag = null;          // {srcEl, startX, startY, active}
    let lastMove = null;      // 最后一次 pointermove 坐标（pointercancel 无坐标，用它判定落点）
    let suppressClickUntil = 0;  // 拖拽结束后拦截随之派发的 click

    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // v0.9.36：时间线视图 clip 不支持拖拽排序（横向滚动区，拖拽语义后续再做）
        if (state.viewMode === 'timeline') return;
        const card = e.target.closest('.shot-card');
        if (!card || state.editingId || state.trashMode) return;
        // 交互控件按下不启动拖拽，保留原交互（按钮/角标/折叠钮/输入框/缺帧占位）
        if (e.target.closest('button, input, .collapse-btn, .cover-chip, .expanded-badge, .frame-missing')) return;
        drag = { srcEl: card, startX: e.clientX, startY: e.clientY, active: false };
    }, true);

    document.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.active) {
            if (Math.hypot(dx, dy) < 6) return;  // 阈值内 = 点击/选择/聚焦，不启动拖拽
            drag.active = true;
            drag.srcEl.classList.add('dragging');
            state.dragSrcEl = drag.srcEl;  // data.js 键盘保护：拖拽中忽略快捷键
            document.body.style.userSelect = 'none';  // 拖拽中防文本/图片选中
        }
        e.preventDefault();  // 拖拽中阻止浏览器默认（不会启动原生 DnD）
        lastMove = { x: e.clientX, y: e.clientY };
        drag.srcEl.style.transform = `translate(${dx}px, ${dy}px) scale(0.7)`;  // 源卡跟随（反馈）；v0.9.34 用户要求拖拽中缩小到 70%
        // 命中检测：鼠标下的卡片（源卡 transform 移开后原位置露出下层元素）
        const el = document.elementFromPoint(e.clientX, e.clientY);
        let card = el && el.closest ? el.closest('.shot-card') : null;
        // v0.9.18：间隙（gap）上命中不了卡片 → 几何兜底找最近卡（两镜中间指示线不消失）
        if (!card || card === drag.srcEl) card = nearestCard(e.clientX, e.clientY, drag.srcEl);
        if (card && card !== drag.srcEl) updateDropIndicator(card, e);
        else hideDropIndicator();
    }, true);

    const finishDrag = (e) => {
        if (!drag) return;
        const st = drag;
        drag = null;
        state.dragSrcEl = null;
        document.body.style.userSelect = '';
        // v0.9.5 修复：先禁过渡把 transform 落定再恢复——否则 remove('dragging')
        // 恢复 transition 后，清 transform 被当作一次过渡（起点 = 旧位置），
        // elementFromPoint 在过渡起点时刻命中"还在旧位置的源卡"→ 落点判定失败
        // （实测 before 方向拖拽必中源卡 = 拖拽不生效；after 方向因 DOM 序侥幸命中）
        st.srcEl.style.transition = 'none';
        st.srcEl.style.transform = '';
        void st.srcEl.offsetWidth;   // 强制 reflow：transition none 下 transform 立即生效
        st.srcEl.style.transition = '';
        st.srcEl.classList.remove('dragging');
        if (!st.active) return;  // 未超阈值 = 点击，原生 click 照常（选择/展开/聚焦）
        suppressClickUntil = Date.now() + 600;  // 拦截拖拽后浏览器补派的 click
        // 释放位置重新命中 + 刷新 dropPos（快速移动时可能过期）；
        // pointercancel 无有效坐标（CDP/系统取消 = (0,0)），用最后一次 pointermove 的位置
        const fx = (e.type === 'pointercancel' && lastMove) ? lastMove.x : e.clientX;
        const fy = (e.type === 'pointercancel' && lastMove) ? lastMove.y : e.clientY;
        const el = document.elementFromPoint(fx, fy);
        let card = el && el.closest ? el.closest('.shot-card') : null;
        // v0.9.18：间隙上释放同样兜底（拖到两镜中间松手 = 插到该间隙，指示线不再消失）
        if (!card || card === st.srcEl) card = nearestCard(fx, fy, st.srcEl);
        if (card && card !== st.srcEl) {
            updateDropIndicator(card, e, fx, fy);
            const pos = card.dataset.dropPos === 'after' ? 'after' : 'before';
            delete card.dataset.dropPos;
            hideDropIndicator();
            reorderShots(st.srcEl.dataset.id, card.dataset.id, pos);
        } else {
            hideDropIndicator();
        }
    };

    document.addEventListener('pointerup', finishDrag, true);
    document.addEventListener('pointercancel', finishDrag, true);

    // 拖拽后抑制浏览器补派的 click（选择/展开等点击逻辑不被拖拽误触发）
    document.addEventListener('click', (e) => {
        if (Date.now() < suppressClickUntil) {
            e.preventDefault();
            e.stopPropagation();
            suppressClickUntil = 0;
        }
    }, true);
}

// ---- 外部图片拖入：上 80% 卡片区=设背景（单图），下 20% 新建区=建镜头 (#5) ----
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

export function initFileDrop() {
    let dragCounter = 0;
    let fileHoverCard = null;

    const overlay = document.getElementById('dropOverlay');
    const zoneCard = document.getElementById('dropZoneCard');
    const zoneNew = document.getElementById('dropZoneNew');

    const setFileHover = (card) => {
        if (fileHoverCard === card) return;
        if (fileHoverCard) fileHoverCard.classList.remove('file-hover');
        fileHoverCard = card;
        if (card) card.classList.add('file-hover');
    };

    const hideOverlay = () => {
        overlay.style.display = 'none';
        setFileHover(null);
        zoneNew.classList.remove('active');
    };

    const createImageShots = async (files) => {
        const imgs = files.filter(f => /image\/(png|jpe?g|webp)/.test(f.type));
        if (!imgs.length) { toast('只支持 png/jpg/webp 图片', true); return; }
        toast(`正在创建 ${imgs.length} 个图片镜头...`);
        const items = await Promise.all(imgs.map(async (f) => {
            const dataUrl = await readFileAsDataURL(f);
            return { filename: f.name, data_base64: dataUrl.split(',')[1] };
        }));
        try {
            const res = await fetch('/api/shots/image', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({items})
            });
            const data = await res.json();
            const okCount = (data.results || []).filter(r => r.status === 'ok').length;
            toast(`已创建 ${okCount} 个图片镜头，拍屏中...`);
        } catch (err) {
            toast('图片镜头创建失败', true);
        }
        fetchShots();
    };

    // 下半新建区 (#6)：实心接管事件，高亮 + 松手直接新建，不透到下层卡片
    // v0.9.5 修复：拦截非文件的原生拖拽——缩略图 <img> 默认 draggable=true，
    // pointerdown 落在 img 上时移动会启动 Chrome 原生图片拖拽，与 Pointer Events
    // 拖拽并存；原生会话中 dragover 不 preventDefault（非文件）→ no-drop 禁止
    // 光标（用户实测：随机出现禁止光标无法调换顺序），且可能吞掉 pointerup。
    // dragstart preventDefault 取消原生会话；外部文件拖入不触发 dragstart
    // （dragstart 只来自页面内元素），不受影响。
    document.addEventListener('dragstart', (e) => {
        if (!isFileDrag(e)) e.preventDefault();
    });

    zoneNew.addEventListener('dragover', (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        zoneNew.classList.add('active');
    });
    zoneNew.addEventListener('dragleave', () => zoneNew.classList.remove('active'));
    zoneNew.addEventListener('drop', (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        hideOverlay();
        createImageShots([...e.dataTransfer.files]);
    });

    document.addEventListener('dragenter', (e) => {
        if (!isFileDrag(e)) return;
        if (state.viewMode === 'timeline') return;  // v0.9.36：时间线视图禁文件拖入（v1 保守）
        dragCounter++;
        overlay.style.display = 'flex';
    });
    document.addEventListener('dragleave', (e) => {
        if (!isFileDrag(e)) return;
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideOverlay();
        }
        if (!e.target.closest || !e.target.closest('.shot-card')) setFileHover(null);
    });
    document.addEventListener('dragover', (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        // 多图时只有新建区可用，卡片区置灰 (#5)
        const multi = e.dataTransfer.items && e.dataTransfer.items.length > 1;
        zoneCard.classList.toggle('disabled', multi);
        zoneCard.querySelector('.zone-text').textContent = multi
            ? '暂不支持单镜头多图（下一轮）'
            : '拖到镜头卡片上 = 设为该镜头背景';
        setFileHover(multi ? null : (e.target.closest ? e.target.closest('.shot-card') : null));
    });
    document.addEventListener('drop', async (e) => {
        if (!isFileDrag(e)) return;
        if (state.viewMode === 'timeline') return;  // v0.9.36：时间线视图禁文件拖入
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        hideOverlay();

        const files = [...e.dataTransfer.files].filter(f => /image\/(png|jpe?g|webp)/.test(f.type));
        if (!files.length) { toast('只支持 png/jpg/webp 图片', true); return; }

        // 落点在卡片上 = 给该镜头设背景图（仅单图）
        const targetCard = e.target.closest('.shot-card');
        if (targetCard) {
            if (files.length > 1) {
                toast('暂不支持单镜头多图，请拖到下方新建区', true);
                return;
            }
            const shotId = targetCard.dataset.id;
            const shot = state.shots.find(s => s.id === shotId);
            toast(`正在给 ${shot ? shot.name : '镜头'} 设置背景图...`);
            const dataUrl = await readFileAsDataURL(files[0]);
            try {
                await fetch(`/api/shot/${shotId}`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        action: 'set_background',
                        filename: files[0].name,
                        data_base64: dataUrl.split(',')[1]
                    })
                });
                toast('背景图已设置，拍屏中...');
            } catch (err) {
                toast('设置背景图失败', true);
            }
            return;
        }

        // 其它空白区域 = 也按新建处理（下半区已在 zone 级拦截，不会走到这）
        createImageShots([...e.dataTransfer.files]);
    });
}
