// 缩略图尺寸：左下角滑块 + Ctrl/⌘+滚轮（顶替浏览器缩放）
// 段落式缩放 (#R6-2)：Eagle/Bridge 同款档位手感——8 档固定尺寸，
// 滑块/滚轮都在档间跳动，不做线性连续变化
const STEPS = [120, 160, 200, 240, 280, 340, 400, 480];
const DEFAULT_IDX = 2;  // 200px

export function initZoom() {
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');
    sizeSlider.min = 0;
    sizeSlider.max = STEPS.length - 1;
    sizeSlider.step = 1;

    const nearestIdx = (px) => {
        let best = 0;
        for (let i = 1; i < STEPS.length; i++) {
            if (Math.abs(STEPS[i] - px) < Math.abs(STEPS[best] - px)) best = i;
        }
        return best;
    };

    let curIdx = nearestIdx(parseInt(localStorage.getItem('sb-card-min') || STEPS[DEFAULT_IDX], 10));

    const applyStep = (i) => {
        curIdx = Math.min(STEPS.length - 1, Math.max(0, i));
        const v = STEPS[curIdx];
        document.documentElement.style.setProperty('--card-min', v + 'px');
        // 列表视图：只有缩略图列跟缩放 (#12)
        document.documentElement.style.setProperty('--list-thumb-w', Math.round(v * 0.4) + 'px');
        sizeValue.textContent = v + 'px';
        sizeSlider.value = curIdx;
        localStorage.setItem('sb-card-min', v);
    };

    // Ctrl+滚轮：攒够一格滚轮量跳一档
    let pending = 0;
    document.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        pending += e.deltaY;
        if (Math.abs(pending) >= 60) {
            applyStep(curIdx + (pending < 0 ? 1 : -1));
            pending = 0;
        }
    }, {passive: false});

    // 滑块（整档吸附）
    applyStep(curIdx);
    sizeSlider.addEventListener('input', () => applyStep(parseInt(sizeSlider.value, 10)));
}
