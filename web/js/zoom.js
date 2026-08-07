// 缩略图尺寸：左下角滑块 + Ctrl/⌘+滚轮
// 宫格：段落式列数缩放，每排 N 张
// 列表：线性像素缩放，滑块无极
import { applyExpandedLayout, relocateDialogue } from './render.js';
const GAP = 12;
const MIN_W = 120;
const MAX_W = 480;
const LIST_MIN_W = 40;
// 列表最大缩略图宽度：由「最大帧数镜头展开时浮层右缘顶到页面右缘」反推。
// 浮层右缘 = gridLeft(16) + 浮层left(4) + padding(2×2) + N×帧宽 + (N-1)×gap(2) + badge(≈43)
// 帧宽 ≈ listThumbW - 7.11（aspect-ratio 16/9 链实测：760→753）
// → maxW = (availWidth - 16 - 4 - 4 - (N-1)*2 - 43 + 7.11*N) / N
const LIST_FLOAT_OFFSET = 16 + 4 + 4;   // grid 左缘 + 浮层 left + padding
const LIST_BADGE_W = 43;                // 展开态帧数角标宽度（实测 "3帧◀"）
const LIST_FRAME_DELTA = 7.11;          // listThumbW → 帧缩略图实际宽度差

export function initZoom() {
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');
    const grid = document.getElementById('grid');

    const availWidth = () => grid.clientWidth || (window.innerWidth - 32);
    const widthFor = (n) => (availWidth() - (n - 1) * GAP) / n;
    // 列表缩略图最大宽度：最大帧数镜头展开浮层刚顶到页面右缘（v0.8.2 公式）
    const listMaxW = () => {
        const shots = window.__sb.state.shots || [];
        const maxFrames = shots.reduce((m, s) => Math.max(m, (s.frames || []).length), 1);
        return Math.max(LIST_MIN_W,
            Math.round((availWidth() - LIST_FLOAT_OFFSET - (maxFrames - 1) * 2
                        - LIST_BADGE_W + LIST_FRAME_DELTA * maxFrames) / maxFrames));
    };
    const nRange = () => {
        let nMin = 1;
        while (nMin < 20 && widthFor(nMin) > MAX_W) nMin++;
        let nMax = nMin;
        while (nMax < 20 && widthFor(nMax + 1) >= MIN_W) nMax++;
        return [nMin, nMax];
    };

    let cols = 0;
    let listThumbW = parseInt(localStorage.getItem('sb-list-thumb-w') || '', 10) || 80;

    // v0.9.2 定位特性：缩放前记录选中卡片中心相对视口中心的偏移，
    // 缩放后恢复该偏移——缩放中心锚定在选中项上（滑块/Ctrl+滚轮/resize 通用）
    const anchor = () => {
        const st = window.__sb && window.__sb.state;
        if (!st || !st.selectedIds || st.selectedIds.size === 0) return null;
        const id = [...st.selectedIds][0];
        const sel = document.querySelector(`.shot-card[data-id="${id}"]`);
        if (!sel) return null;
        const r = sel.getBoundingClientRect();
        return { id, rel: r.top + r.height / 2 - window.innerHeight / 2 };
    };
    const restoreAnchor = (a) => {
        if (!a) return;
        const sel = document.querySelector(`.shot-card[data-id="${a.id}"]`);
        if (!sel) return;
        const r = sel.getBoundingClientRect();
        const target = window.scrollY + (r.top + r.height / 2 - window.innerHeight / 2) - a.rel;
        window.scrollTo(0, Math.max(0, target));
    };

    const apply = () => {
        const a = anchor();  // 缩放前捕获选中项位置
        if (window.__sb && window.__sb.state.viewMode === 'list') {
            // 列表：线性像素，最大 = 最大帧数镜头展开浮层刚顶到页面右缘
            const maxW = listMaxW();
            listThumbW = Math.min(maxW, Math.max(LIST_MIN_W, listThumbW));
            document.documentElement.style.setProperty('--list-thumb-w', listThumbW + 'px');
            sizeValue.textContent = Math.round(listThumbW) + 'px';
            sizeSlider.min = LIST_MIN_W;
            sizeSlider.max = maxW;
            sizeSlider.step = 1;
            sizeSlider.value = listThumbW;
            localStorage.setItem('sb-list-thumb-w', listThumbW);
        } else {
            // 宫格：列数段落
            const [nMin, nMax] = nRange();
            cols = Math.min(nMax, Math.max(nMin, cols));
            const w = widthFor(cols);
            document.documentElement.style.setProperty('--card-min', w.toFixed(2) + 'px');
            document.documentElement.style.setProperty('--list-thumb-w', Math.round(w * 0.4) + 'px');
            sizeValue.textContent = cols + ' 列';
            sizeSlider.min = 0;
            sizeSlider.max = nMax - nMin;
            sizeSlider.step = 1;
            sizeSlider.value = nMax - cols;
            localStorage.setItem('sb-cols', cols);
        }
        // v0.9.5：缩放/预览调宽后重算展开态帧图等大布局（--frame-w + margin-left），
        // 只改变量/内联样式不重建 DOM——丝滑原则（grid 列数变化时行分段类也顺带同步）
        if (window.__sb && window.__sb.state.viewMode === 'grid') {
            applyExpandedLayout();
            relocateDialogue();  // v0.9.8：列数变 → 台词镜头换排/列宽变，条位置+默认宽重算
        }
        // v0.9.17 修复：restoreAnchor 必须挪到展开态布局 + 台词条重排之后——
        // 原顺序在 relocateDialogue 前，父条合并/换排（列数变 → 行数变）会改变焦点镜头的
        // 最终布局位置，旧布局算的滚动目标差一个父条行高（实测长台词父条场景偏移 206px）
        restoreAnchor(a);  // v0.9.2：缩放后恢复选中项位置（锚定缩放中心）
    };

    // 初始
    const storedCols = parseInt(localStorage.getItem('sb-cols') || '', 10);
    if (storedCols) {
        cols = storedCols;
    } else {
        const target = parseInt(localStorage.getItem('sb-card-min') || '', 10) || 200;
        const [nMin, nMax] = nRange();
        cols = nMin;
        for (let n = nMin + 1; n <= nMax; n++) {
            if (Math.abs(widthFor(n) - target) < Math.abs(widthFor(cols) - target)) cols = n;
        }
    }
    apply();

    // 滑块
    sizeSlider.addEventListener('input', () => {
        if (window.__sb && window.__sb.state.viewMode === 'list') {
            listThumbW = parseInt(sizeSlider.value, 10);
        } else {
            const [, nMax] = nRange();
            cols = nMax - parseInt(sizeSlider.value, 10);
        }
        apply();
    });

    // Ctrl+滚轮
    let pending = 0;
    document.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        if (window.__sb && window.__sb.state.viewMode === 'list') {
            // v0.9.3：Ctrl+滚轮全程 12 级（用户拍板）——步距 = (maxW-minW)/12，40px→maxW 恰好 12 下；
            // 按档位序号对齐（round 反推），消除累计取整漂移
            const maxW = listMaxW();
            const step = (maxW - LIST_MIN_W) / 12;
            const idx = Math.round((listThumbW - LIST_MIN_W) / step);
            const next = Math.min(12, Math.max(0, idx + (e.deltaY > 0 ? -1 : 1)));
            listThumbW = Math.round(LIST_MIN_W + next * step);
            apply();
            return;
        }
        pending += e.deltaY;
        if (Math.abs(pending) >= 60) {
            cols += pending > 0 ? 1 : -1;
            pending = 0;
            apply();
        }
    }, {passive: false});

    // resize
    let resizeRaf = null;
    window.addEventListener('resize', () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => { resizeRaf = null; apply(); });
    });

    window.__zoomApply = apply;
}
