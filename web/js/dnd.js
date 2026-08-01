// 卡片拖拽排序（支持整组移动）+ 拖图落点分流
import { state, grid } from './state.js';
import { renderGrid } from './render.js';
import { toast } from './ui.js';
import { fetchShots } from './data.js';

export function isFileDrag(e) {
    return e.dataTransfer && [...e.dataTransfer.types].includes('Files');
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
        if (!card || state.editingId) return;
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

// ---- 外部图片拖入：空白=新建镜头，卡片=设背景 ----
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

    document.addEventListener('dragenter', (e) => {
        if (!isFileDrag(e)) return;
        dragCounter++;
        document.getElementById('dropOverlay').style.display = 'flex';
    });
    document.addEventListener('dragleave', (e) => {
        if (!isFileDrag(e)) return;
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            document.getElementById('dropOverlay').style.display = 'none';
        }
    });
    document.addEventListener('dragover', (e) => {
        if (isFileDrag(e)) e.preventDefault();
    });
    document.addEventListener('drop', async (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        document.getElementById('dropOverlay').style.display = 'none';

        const files = [...e.dataTransfer.files].filter(f => /image\/(png|jpe?g|webp)/.test(f.type));
        if (!files.length) { toast('只支持 png/jpg/webp 图片', true); return; }

        // 落点在卡片上 = 给该镜头设背景图（仅取第一张）
        const targetCard = e.target.closest('.shot-card');
        if (targetCard) {
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

        // 空白处 = 创建图片镜头
        toast(`正在创建 ${files.length} 个图片镜头...`);
        const items = await Promise.all(files.map(async (f) => {
            const dataUrl = await readFileAsDataURL(f);
            return {
                filename: f.name,
                data_base64: dataUrl.split(',')[1]
            };
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
    });
}
