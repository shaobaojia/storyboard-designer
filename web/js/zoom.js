// 缩略图尺寸：左下角滑块 + Ctrl/⌘+滚轮（顶替浏览器缩放）
export function initZoom() {
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');

    const applyCardSize = (v) => {
        document.documentElement.style.setProperty('--card-min', v + 'px');
        sizeValue.textContent = v + 'px';
        localStorage.setItem('sb-card-min', v);
    };

    // Ctrl+滚轮缩放
    document.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const cur = parseInt(sizeSlider.value, 10);
        const next = Math.min(480, Math.max(120, cur + (e.deltaY < 0 ? 20 : -20)));
        sizeSlider.value = next;
        applyCardSize(next);
    }, {passive: false});

    // 滑块
    sizeSlider.value = localStorage.getItem('sb-card-min') || 200;
    applyCardSize(sizeSlider.value);
    sizeSlider.addEventListener('input', () => applyCardSize(sizeSlider.value));
}
