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

async function reorderShots(srcId, dstId) {
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
    const at = insertIdx === -1 ? rest.length : (dstIdx > srcIdx ? insertIdx + 1 : insertIdx);
    rest.splice(at, 0, ...moving);
    state.shots = rest;

    try {
        await fetch('/api/reorder', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({shot_ids: state.shots.map(s => s.id)})
        });
    } catch (e) {
        console.error('Reorder failed:', e);
    }
    renderGrid();  // FLIP 动效在 renderGrid 内部处理
}

// ---- 卡片拖拽（grid 委托）----
export function initCardDnd() {
    grid.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.shot-card');
        // v0.9.1：展开态帧格也可拖（frame-cell 的 data-id 即 shotId，reorderShots 落点
        // 有 movingIds.includes(dstId) 保护不会自排）；v0.8.1 曾禁止是因拖帧格把整镜头
        // 排到末尾，该 bug 已由落点保护修复
        if (!card || state.editingId || state.trashMode) {
            e.preventDefault();
            return;
        }
        state.dragSrcEl = card;
        e.dataTransfer.setData('text/x-shot-id', card.dataset.id);  // 标记内部拖拽，区别于外部文件
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
    });

    grid.addEventListener('dragover', (e) => {
        if (isFileDrag(e)) return;  // 文件拖拽交给 drop 逻辑
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const card = e.target.closest('.shot-card');
        if (card && card !== state.dragSrcEl) {
            card.classList.add('drag-over');
        }
        return false;
    });

    grid.addEventListener('dragleave', (e) => {
        const card = e.target.closest('.shot-card');
        if (card) card.classList.remove('drag-over');
    });

    grid.addEventListener('drop', (e) => {
        if (isFileDrag(e)) return;  // 文件落点由 document 的 drop 统一处理
        e.preventDefault();
        e.stopPropagation();
        const card = e.target.closest('.shot-card');
        if (card && state.dragSrcEl && card !== state.dragSrcEl) {
            card.classList.remove('drag-over');
            reorderShots(state.dragSrcEl.dataset.id, card.dataset.id);
        }
        return false;
    });

    grid.addEventListener('dragend', (e) => {
        if (state.dragSrcEl) state.dragSrcEl.classList.remove('dragging');
        document.querySelectorAll('.shot-card').forEach(c => {
            c.classList.remove('dragging', 'drag-over');
        });
        state.dragSrcEl = null;
    });
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
