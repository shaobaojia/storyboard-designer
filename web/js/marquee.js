// 框选：空白处左键拖出选框，命中卡片即选中（Ctrl 追加）
import { state } from './state.js';
import { updateSelectionUI } from './selection.js';

export function initMarquee() {
    const marqueeBox = document.getElementById('marqueeBox');
    let marqueeStart = null;

    document.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        // v0.9.62：时间线视图启用框选——clip 复用 .shot-card，mouseup 矩形相交判定天然适用；
        // 时间线台词条（.tl-dlg-clip）按下 = 台词拖拽/调宽（pointerdown capture 先行），排除防框选抢启动
        if (e.target.closest('.shot-card') || e.target.closest('.tl-dlg-clip') ||
            e.target.closest('.context-menu') || e.target.closest('.modal-overlay') ||
            e.target.closest('.size-slider') ||
            // v0.9.24：缩放滑块挪到独立 .zoom-bar 容器（左下角），排除列表必须同步——
            // 漏了的话滑块 mousedown 被 preventDefault，原生 range 拖动/点击全部失效
            e.target.closest('.zoom-bar') ||
            e.target.closest('#statsBadge') || e.target.closest('.confirm-bar') ||
            e.target.closest('.header') ||
            // v0.9.4：预览框/快捷键面板是展示型浮层，内部点击不该触发框选清空选中
            e.target.closest('.preview-panel') || e.target.closest('.shortcuts-panel') ||
            // v0.9.8：宫格台词条（排间行）也是展示型区域
            e.target.closest('.dialogue-strip')) return;
        // v0.9.29：框选起点阻止浏览器默认——拖过卡片文字/时长时启动原生文本选中（蓝块）
        e.preventDefault();
        state.marqueeActive = true;
        marqueeStart = {x: e.clientX, y: e.clientY, ctrl: e.ctrlKey || e.metaKey};
        marqueeBox.style.display = 'block';
        marqueeBox.style.left = e.clientX + 'px';
        marqueeBox.style.top = e.clientY + 'px';
        marqueeBox.style.width = '0px';
        marqueeBox.style.height = '0px';
    });

    document.addEventListener('mousemove', (e) => {
        if (!state.marqueeActive || !marqueeStart) return;
        const x1 = Math.min(marqueeStart.x, e.clientX);
        const y1 = Math.min(marqueeStart.y, e.clientY);
        const x2 = Math.max(marqueeStart.x, e.clientX);
        const y2 = Math.max(marqueeStart.y, e.clientY);
        marqueeBox.style.left = x1 + 'px';
        marqueeBox.style.top = y1 + 'px';
        marqueeBox.style.width = (x2 - x1) + 'px';
        marqueeBox.style.height = (y2 - y1) + 'px';
    });

    document.addEventListener('mouseup', (e) => {
        if (e.button !== 0 || !state.marqueeActive || !marqueeStart) return;
        state.marqueeActive = false;
        marqueeBox.style.display = 'none';
        const x1 = Math.min(marqueeStart.x, e.clientX);
        const y1 = Math.min(marqueeStart.y, e.clientY);
        const x2 = Math.max(marqueeStart.x, e.clientX);
        const y2 = Math.max(marqueeStart.y, e.clientY);
        const moved = (x2 - x1) + (y2 - y1) > 6;

        if (!marqueeStart.ctrl) state.selectedIds.clear();
        if (moved) {
            document.querySelectorAll('.shot-card').forEach(c => {
                const r = c.getBoundingClientRect();
                const hit = r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1;
                if (hit) state.selectedIds.add(c.dataset.id);
            });
        }
        marqueeStart = null;
        updateSelectionUI();
    });
}
