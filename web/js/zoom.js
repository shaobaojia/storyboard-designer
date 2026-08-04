// 缩略图尺寸：左下角滑块 + Ctrl/⌘+滚轮
// 宫格：段落式列数缩放，每排 N 张
// 列表：线性像素缩放，滑块无极
const GAP = 12;
const MIN_W = 120;
const MAX_W = 480;
const LIST_MIN_W = 40;
const LIST_MAX_FACTOR = 1.6; // 最大缩略图宽度系数

export function initZoom() {
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');
    const grid = document.getElementById('grid');

    const availWidth = () => grid.clientWidth || (window.innerWidth - 32);
    const widthFor = (n) => (availWidth() - (n - 1) * GAP) / n;
    const nRange = () => {
        let nMin = 1;
        while (nMin < 20 && widthFor(nMin) > MAX_W) nMin++;
        let nMax = nMin;
        while (nMax < 20 && widthFor(nMax + 1) >= MIN_W) nMax++;
        return [nMin, nMax];
    };

    let cols = 0;
    let listThumbW = parseInt(localStorage.getItem('sb-list-thumb-w') || '', 10) || 80;

    const apply = () => {
        if (window.__sb && window.__sb.state.viewMode === 'list') {
            // 列表：线性像素
            const maxW = Math.round(availWidth() * 0.55); // 面板右侧留白
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
            listThumbW += e.deltaY > 0 ? -10 : 10;
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
