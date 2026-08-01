// 缩略图尺寸：左下角滑块 + Ctrl/⌘+滚轮（顶替浏览器缩放）
// 段落式缩放 (#R6-2/#R6-5)：档位的依据是"每排镜头数 ±1"，不是绝对像素——
// 卡片宽度由可用宽度反算（(宽-gap*(N-1))/N，保留两位小数），
// 每排永远恰好 N 张、行尾不留半格空位；窗口 resize 时列数不变、宽度重算
const GAP = 12;
const MIN_W = 120;   // 再小就密得没法看了
const MAX_W = 480;   // 再大就蠢了

export function initZoom() {
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');
    const grid = document.getElementById('grid');

    const availWidth = () => grid.clientWidth || (window.innerWidth - 32);
    const widthFor = (n) => (availWidth() - (n - 1) * GAP) / n;
    // 合法列数区间：反算宽度落在 [MIN_W, MAX_W] 内的 N 才给选
    const nRange = () => {
        let nMin = 1;
        while (nMin < 20 && widthFor(nMin) > MAX_W) nMin++;
        let nMax = nMin;
        while (nMax < 20 && widthFor(nMax + 1) >= MIN_W) nMax++;
        return [nMin, nMax];
    };

    let cols = 0;  // 当前每排镜头数（缩放的唯一状态）

    const apply = () => {
        const [nMin, nMax] = nRange();
        cols = Math.min(nMax, Math.max(nMin, cols));
        const w = widthFor(cols);
        document.documentElement.style.setProperty('--card-min', w.toFixed(2) + 'px');
        // 列表视图：只有缩略图列跟缩放 (#12)
        document.documentElement.style.setProperty('--list-thumb-w', Math.round(w * 0.4) + 'px');
        sizeValue.textContent = `${cols} 列`;
        // 滑块：左 = 多列（小图），右 = 少列（大图），与"往右变大"的直觉一致
        sizeSlider.min = 0;
        sizeSlider.max = nMax - nMin;
        sizeSlider.step = 1;
        sizeSlider.value = nMax - cols;
        localStorage.setItem('sb-cols', cols);
    };

    // 初始列数：老用户的 px 记录就近换算成列数；没有就选最接近 200px 的列数
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

    // 滑块：整档吸附（档位即列数）
    sizeSlider.addEventListener('input', () => {
        const [, nMax] = nRange();
        cols = nMax - parseInt(sizeSlider.value, 10);
        apply();
    });

    // Ctrl+滚轮：攒够一格滚轮量跳一列
    let pending = 0;
    document.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        pending += e.deltaY;
        if (Math.abs(pending) >= 60) {
            cols += pending > 0 ? 1 : -1;  // 下滚 = 多列小图，上滚 = 少列大图
            pending = 0;
            apply();
        }
    }, {passive: false});

    // 窗口 resize：列数不变，宽度按新窗口重算——行尾依然严丝合缝
    let resizeRaf = null;
    window.addEventListener('resize', () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => { resizeRaf = null; apply(); });
    });
}
