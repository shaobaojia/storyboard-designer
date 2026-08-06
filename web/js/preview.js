// 预览框（v0.9.4）：左下角工具条「预览」开关，显示选中镜头大图
// 丝滑原理：开关/切边只动 CSS（grid margin + --card-scale/--list-scale + __zoomApply），
// 零 DOM 重建、零 renderGrid（除已展开镜头需重算底衬分段时）；列数保持、卡片等比缩放
import { state } from './state.js';
import { renderGrid } from './render.js';

const GAP = 12;
const panel = document.getElementById('previewPanel');
const btn = document.getElementById('previewBtn');
const img = document.getElementById('previewImg');
const emptyEl = document.getElementById('previewEmpty');
const foot = document.getElementById('previewFoot');
const flip = document.getElementById('previewFlip');
const resizeEl = document.getElementById('previewResize');
const nameEl = document.getElementById('previewName');
const subEl = document.getElementById('previewSub');
const durEl = document.getElementById('pfDuration');
const contentEl = document.getElementById('pfContent');
const dialogueEl = document.getElementById('pfDialogue');
let savedMin = null;  // 宫格开预览前的 --card-min（关闭时精确还原比例）
let wFull = 0;        // 开预览时的 grid 全宽（列表 --list-scale 的缩放基准）
let closeTimer = null;  // 关闭动画计时器（防快速开关冲突，v0.9.5）

// 大图 URL：缩略图文件名 → 全尺寸 still（v0.9.4 新格式 _still.jpg / still.jpg；
// 老数据 _still.png / still.png 由 showPreviewImage 的 onerror 兜底），保留 ?v= 缓存戳
function stillUrl(url) {
    if (!url) return url;
    const [p, q] = url.split('?');
    let s = p;
    if (s.endsWith('_thumb.jpg')) s = s.slice(0, -10) + '_still.jpg';
    else if (s.endsWith('thumb.jpg')) s = s.slice(0, -9) + 'still.jpg';
    return q ? `${s}?${q}` : s;
}
// jpg 404（存量镜头还是 png）→ 退回 png
function stillFallback(url) {
    return url.replace('_still.jpg', '_still.png').replace('still.jpg', 'still.png');
}

// 先小图后清晰：立即显示缩略图（已缓存，即时），大图就绪后替换（同帧渲染无闪烁）
// dataset.pending 防竞态：快速切换时只认最后一次的请求
function showPreviewImage(thumbUrl, bigUrl) {
    const pending = String(bigUrl);
    img.dataset.pending = pending;
    const cached = preloadCache.get(bigUrl);
    if (cached && cached.ready) {
        img.src = bigUrl;  // 已预载/加载过 → 秒显
        return;
    }
    img.src = thumbUrl;  // 先小图
    const loader = new Image();
    loader.onload = () => {
        if (img.dataset.pending === pending) {
            img.src = bigUrl;
            preloadCache.set(bigUrl, { ready: true });
        }
    };
    loader.onerror = () => {
        if (img.dataset.pending !== pending) return;
        const pngUrl = stillFallback(bigUrl);
        if (pngUrl === bigUrl) return;
        const p2 = new Image();
        p2.onload = () => {
            if (img.dataset.pending === pending) {
                img.src = pngUrl;
                preloadCache.set(pngUrl, { ready: true });
            }
        };
        p2.src = pngUrl;
    };
    loader.src = bigUrl;
}

// 相邻预载（v0.9.4）：选中镜头前后各 10 格的封面 still 预热（JPG ~300-600KB × 20 ≈ 8MB 内存）。
// new Image() 预热浏览器 HTTP+解码缓存，切换时秒显；防抖 120ms（快速切换只预载最终位置）
const preloadCache = new Map();
let preloadTimer = null;
function preloadNeighbors() {
    const shots = state.shots;
    const curId = state.lastClickId || [...state.selectedIds][0];
    let idx = shots.findIndex(s => s.id === curId);
    if (idx < 0) return;
    const targets = [];
    for (let i = Math.max(0, idx - 10); i < Math.min(shots.length, idx + 11); i++) {
        if (i === idx) continue;
        const s = shots[i];
        const cover = (s.frames || []).find(f => f.isCover) || (s.frames || [])[0];
        if (cover && cover.imageUrl) targets.push(stillUrl(cover.imageUrl));
    }
    if (preloadTimer) clearTimeout(preloadTimer);
    preloadTimer = setTimeout(() => {
        targets.forEach(u => {
            if (preloadCache.has(u)) return;
            const holder = { ready: false };
            preloadCache.set(u, holder);
            const im = new Image();
            im.onload = () => { holder.ready = true; };
            im.onerror = () => {
                preloadCache.delete(u);
                // 存量 png 镜头：jpg 404 → 把 png 也预载上，切回时秒显
                const pngUrl = stillFallback(u);
                if (pngUrl === u) return;
                const holder2 = { ready: false };
                preloadCache.set(pngUrl, holder2);
                const im2 = new Image();
                im2.onload = () => { holder2.ready = true; };
                im2.onerror = () => { preloadCache.delete(pngUrl); };
                im2.src = pngUrl;
            };
            im.src = u;
        });
    }, 120);
}

// 弹簧动画（v0.9.5）：打开 = 弹入（scale .92→1.015→1 + overshoot）；关闭 = 先弹走再隐藏
function showPanel() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    panel.classList.remove('panel-out');
    if (panel.style.display === 'flex' && panel.classList.contains('panel-in')) return;
    panel.style.display = 'flex';
    panel.classList.remove('panel-in');
    void panel.offsetWidth;  // 强制 reflow，重启动画
    panel.classList.add('panel-in');
}
function hidePanel() {
    if (panel.style.display === 'none' || panel.classList.contains('panel-out')) return;
    panel.classList.remove('panel-in');
    panel.classList.add('panel-out');
    closeTimer = setTimeout(() => {
        closeTimer = null;
        panel.style.display = 'none';
        panel.classList.remove('panel-out');
    }, 200);  // 匹配 .panel-out 动画时长
}

function applyLayout() {
    const grid = document.getElementById('grid');
    grid.classList.toggle('preview-on', state.previewOn);
    grid.classList.toggle('preview-right', state.previewOn && state.previewSide === 'right');
    grid.classList.toggle('preview-left', state.previewOn && state.previewSide === 'left');
    panel.classList.toggle('side-right', state.previewSide === 'right');
    panel.classList.toggle('side-left', state.previewSide === 'left');
    if (state.previewOn) showPanel(); else hidePanel();
    btn.classList.toggle('active-view', state.previewOn);
    flip.textContent = state.previewSide === 'right' ? '⇄ 贴到左侧' : '⇄ 贴到右侧';
}

// 预览对象 = 最后点击/移动到的镜头（lastClickId），无则第一个选中；
// 该镜头展开且帧格聚焦时显示该帧大图，否则封面帧大图
// 详情区：标题(镜头名)在上，时长/内容/台词在下
function setDetail(shot, frame) {
    if (!shot) {
        nameEl.textContent = '预览';
        subEl.textContent = '';
        durEl.textContent = '—';
        contentEl.textContent = '—';
        dialogueEl.textContent = '—';
        contentEl.classList.remove('empty');
        dialogueEl.classList.remove('empty');
        return;
    }
    nameEl.textContent = shot.name;
    subEl.textContent = frame
        ? `f${frame.frame_no}${frame.isCover ? ' · 封面' : ''}`
        : (shot.frames || []).length > 1 ? '多图' : '';
    durEl.textContent = shot.duration != null ? shot.duration.toFixed(1) + 's' : '—';
    contentEl.textContent = shot.content || '（无内容）';
    contentEl.classList.toggle('empty', !shot.content);
    dialogueEl.textContent = shot.dialogue || '（无台词）';
    dialogueEl.classList.toggle('empty', !shot.dialogue);
}

export function updatePreview() {
    if (!state.previewOn) return;
    const shots = state.shots;
    let targetId = (state.lastClickId && shots.some(s => s.id === state.lastClickId))
        ? state.lastClickId : null;
    if (!targetId) targetId = [...state.selectedIds][0] || null;
    const shot = targetId ? shots.find(s => s.id === targetId) : null;
    if (!shot) {
        img.style.display = 'none';
        emptyEl.style.display = 'block';
        emptyEl.textContent = '未选中镜头';
        setDetail(null, null);
        return;
    }
    const frames = shot.frames || [];
    let frame = null;
    if (state.focusedFrameId && frames.some(f => f.id === state.focusedFrameId)) {
        frame = frames.find(f => f.id === state.focusedFrameId);
    } else {
        frame = frames.find(f => f.isCover) || frames[0] || null;
    }
    if (!frame || !frame.imageUrl) {
        img.style.display = 'none';
        emptyEl.style.display = 'block';
        emptyEl.textContent = `${shot.name} · 暂无图片`;
        setDetail(shot, null);
        return;
    }
    emptyEl.style.display = 'none';
    img.style.display = 'block';
    showPreviewImage(frame.imageUrl, stillUrl(frame.imageUrl));
    setDetail(shot, frame);
    preloadNeighbors();  // 预热相邻 ±10 格大图，切换秒显
}

export function setPreview(on) {
    if (on === state.previewOn) return;
    state.previewOn = on;
    const gridEl = document.getElementById('grid');
    const wFullNow = gridEl.clientWidth;  // 布局变化前的宽度（开时=全宽；关时=窄宽）
    if (on) wFull = wFullNow;
    // 恢复上次拖拽的宽度（localStorage，默认 50vw-16）
    const saved = parseFloat(localStorage.getItem('sb-preview-w') || '', 10);
    if (on && saved && saved > 120) {
        document.documentElement.style.setProperty('--preview-w', saved + 'px');
    }
    applyLayout();  // 先改布局（grid margin/class + 预览框显隐），再让 zoom 用新宽度重算
    if (on) {
        if (state.viewMode === 'list') {
            // 列表：固定列等比缩小（--list-scale），不碰滑块/zoom 内部状态
            const wNew = Math.max(120, Math.round(document.getElementById('gridWrap').clientWidth / 2));
            document.documentElement.style.setProperty('--list-scale', Math.max(0.3, Math.min(1, wNew / wFullNow)).toFixed(4));
        } else {
            // 宫格：列数保持、卡片等比缩小——__zoomApply 用窄宽 + 当前列数重算 --card-min
            // （MIN_W=120 是列数下限：窄宽下可能少 1 列、卡片 ~130px，属设计下限）
            const cur = getComputedStyle(document.documentElement).getPropertyValue('--card-min').trim();
            if (!savedMin) savedMin = cur;
            if (window.__zoomApply) window.__zoomApply();
        }
    } else {
        document.documentElement.style.setProperty('--list-scale', '1');
        if (state.viewMode !== 'list') {
            if (savedMin) {
                // 精确还原开预览前的卡片尺寸（不经过 zoom 状态，避免列数漂移）
                document.documentElement.style.setProperty('--card-min', savedMin);
                savedMin = null;
                const sel = document.querySelector('.shot-card.selected');
                if (sel) sel.scrollIntoView({ block: 'nearest' });
            } else if (window.__zoomApply) {
                window.__zoomApply();
            }
        }
    }
    // 宽度变化 → 列数变 → 已展开镜头底衬行分段要重算（差分复用节点，不重建 DOM）
    if (state.expandedShotIds.size > 0) renderGrid();
    updatePreview();
}

// 预览框当前宽度（--preview-w）
function currentPreviewW() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--preview-w')) || 0;
}

// 设置预览框宽度 + 实时缩放适配（拖拽中逐帧调用）：
// 宫格 → __zoomApply 用新窄宽重算 --card-min（卡片连续缩放填满，无空白）
// 列表 → --list-scale = 新窄宽 / 全宽（固定列等比缩小）
export function setPreviewW(w) {
    const minW = 180;
    const maxW = Math.max(minW + 60, window.innerWidth - 360);
    w = Math.max(minW, Math.min(maxW, Math.round(w)));
    document.documentElement.style.setProperty('--preview-w', w + 'px');
    if (!state.previewOn) return;
    if (state.viewMode === 'list') {
        const gridW = document.getElementById('grid').clientWidth;
        if (wFull) {
            document.documentElement.style.setProperty('--list-scale', Math.max(0.3, Math.min(1, gridW / wFull)).toFixed(4));
        }
    } else if (window.__zoomApply) {
        window.__zoomApply();
    }
    // 预览框宽度变化不影响布局列数之外的 DOM——无 renderGrid 需要
}

function initResize() {
    if (!resizeEl) return;
    let dragging = false;
    let startX = 0;
    let startW = 0;
    let rafId = 0;
    resizeEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startW = currentPreviewW();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        if (rafId) return;  // 节流：一帧一次
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            const delta = state.previewSide === 'right' ? startX - e.clientX : e.clientX - startX;
            setPreviewW(startW + delta);
        });
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('sb-preview-w', String(Math.round(currentPreviewW())));
    });
}

export function togglePreviewSide() {
    if (!state.previewOn) return;
    state.previewSide = state.previewSide === 'right' ? 'left' : 'right';
    applyLayout();  // 只改 class：宽度不变 → 列数不变 → 无重排、无需 renderGrid
    if (state.viewMode === 'list') {
        const sel = document.querySelector('.shot-card.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    } else if (window.__zoomApply) {
        window.__zoomApply();  // 锚定：grid 移侧后选中卡保持在视口相对位置
    }
}

export function initPreview() {
    if (!btn || !panel) return;
    btn.addEventListener('click', () => setPreview(!state.previewOn));
    if (flip) flip.addEventListener('click', togglePreviewSide);
    const closeBtn = document.getElementById('previewClose');
    if (closeBtn) closeBtn.addEventListener('click', () => setPreview(false));
    initResize();
}
