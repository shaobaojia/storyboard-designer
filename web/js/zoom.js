// 缩略图尺寸：左下角滑块 + Ctrl/⌘+滚轮（顶替浏览器缩放）
// 连续无级缩放（#10）：单模块自包含，改回档位版只需动 wheelDelta 一行
export function initZoom() {
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');

    const applyCardSize = (v) => {
        v = Math.round(v);
        document.documentElement.style.setProperty('--card-min', v + 'px');
        // 列表视图：只有缩略图列跟缩放 (#12)
        document.documentElement.style.setProperty('--list-thumb-w', Math.round(v * 0.4) + 'px');
        sizeValue.textContent = v + 'px';
        sizeSlider.value = v;
        localStorage.setItem('sb-card-min', v);
    };

    // Ctrl+滚轮：按 deltaY 连续变化，rAF 节流防掉帧
    let pending = 0;
    let rafId = null;
    document.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        pending += -e.deltaY * 0.25;  // 一格滚轮 ≈ ±30px，无段落感
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            const cur = parseInt(sizeSlider.value, 10);
            const next = Math.min(480, Math.max(120, cur + pending));
            pending = 0;
            if (next !== cur) applyCardSize(next);
        });
    }, {passive: false});

    // 滑块（step=1，连续）
    sizeSlider.value = localStorage.getItem('sb-card-min') || 200;
    applyCardSize(parseInt(sizeSlider.value, 10));
    sizeSlider.addEventListener('input', () => applyCardSize(parseInt(sizeSlider.value, 10)));
}
