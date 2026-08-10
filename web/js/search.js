// 搜索栏（v0.9.3）：页面上方输入，匹配镜头名/内容/台词，
// 下拉列出匹配项，点击定位到该镜头（滚动居中 + 单选 + 蓝框），宫格/列表通用。
import { state } from './state.js';
import { renderGrid } from './render.js';
import { focusFrame } from './frames.js';
import { tlReveal } from './timeline.js';  // v0.9.53：时间线定位走舞台 reveal（70% 区内最小滚动）

const input = document.getElementById('searchInput');
const results = document.getElementById('searchResults');
let debounceTimer = null;
let selIdx = -1;  // v0.9.18：键盘预选索引（-1 = 无预选）

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// 命中字段优先级：名称 > 内容 > 台词；返回 -1 表示无匹配
function fieldHits(shot, q) {
    const hit = (v) => (v || '').toLowerCase().includes(q);
    if (hit(shot.name)) return 0;
    if (hit(shot.content)) return 1;
    if (hit(shot.dialogue)) return 2;
    return -1;
}

function renderResults(list) {
    if (!list.length) {
        results.style.display = 'none';
        selIdx = -1;
        return;
    }
    const typeMap = { '3d': '3D', '2d': '2D', 'ref': '参考' };
    results.innerHTML = list.map((s) => {
        const badge = typeMap[s.type] ? `<span class="search-item-type">${typeMap[s.type]}</span>` : '';
        const sub = s.content || s.dialogue || '';
        return `<div class="search-item" data-id="${s.id}">
            <span class="search-item-name">${esc(s.name)}</span>${badge}
            ${sub ? `<span class="search-item-sub">${esc(sub)}</span>` : ''}
        </div>`;
    }).join('');
    results.style.display = 'block';
    selIdx = -1;  // 重渲染后预选清零
}

// v0.9.18：键盘预选高亮 + 滚动到可见
function applySel() {
    const items = [...results.querySelectorAll('.search-item')];
    items.forEach((it, i) => it.classList.toggle('selected', i === selIdx));
    if (selIdx >= 0 && items[selIdx]) {
        items[selIdx].scrollIntoView({ block: 'nearest' });
    }
}

function onInput() {
    clearTimeout(debounceTimer);
    const kw = input.value.trim();
    if (!kw) {
        results.style.display = 'none';
        return;
    }
    debounceTimer = setTimeout(() => {
        const q = kw.toLowerCase();
        const hits = state.shots
            .map((s) => ({ s, rank: fieldHits(s, q) }))
            .filter((h) => h.rank >= 0)
            .sort((a, b) => a.rank - b.rank)
            .slice(0, 12);
        renderResults(hits.map((h) => h.s));
    }, 200);
}

function locate(shotId) {
    // 展开态多图定位到帧格，否则折叠卡/列表行（两种视图都是 .shot-card）
    const el = document.querySelector(`.shot-card.frame-cell[data-id="${shotId}"]`)
        || document.querySelector(`.shot-card[data-id="${shotId}"]`);
    if (!el) return;
    // 先选中+渲染（renderGrid 保存/恢复滚动位置），再滚动定位：
    // scrollIntoView 的滚动是渲染帧才提交的，若在 renderGrid 前调用会被其恢复逻辑覆盖
    state.selectedIds.clear();
    state.selectedIds.add(shotId);
    state.anchorId = shotId;
    // 清除帧级焦点：focusFrame(shotId, null) 同时清 state.focusedFrameId 和 DOM 上的
    // .frame-focused 蓝框（差分复用的帧格不会重算这个 class，只清状态会残留蓝框——实测 bug）
    focusFrame(shotId, null);
    // v0.9.53：时间线定位走舞台 reveal（70% 区内最小滚动）——renderGrid 会重建时间线 DOM，
    // 必须在渲染前记住目标 id、渲染后重新查询（旧 el 已脱离 DOM，直接 scrollIntoView 无效）
    const tlTarget = (window.__sb && window.__sb.state.viewMode === 'timeline' && el.closest('#timeline'))
        ? ((el.closest('.timeline-clip') || el).dataset.id || null) : null;
    renderGrid();
    if (tlTarget) {
        const clip = document.querySelector(`.timeline-clip[data-id="${tlTarget}"]`);
        if (clip) tlReveal(clip);
    } else {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
}

export function initSearch() {
    input.addEventListener('input', onInput);
    // 输入框内 Enter = 定位预选项（无预选则第一个匹配项）；↑↓ = 预选移动
    input.addEventListener('keydown', (e) => {
        if (results.style.display === 'none') return;
        const items = results.querySelectorAll('.search-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selIdx = Math.min(selIdx + 1, items.length - 1);
            applySel();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selIdx = Math.max(selIdx - 1, 0);
            applySel();
        } else if (e.key === 'Enter') {
            const target = selIdx >= 0 ? items[selIdx] : items[0];
            if (target) {
                e.preventDefault();
                locate(target.dataset.id);
                input.value = '';
                results.style.display = 'none';
                selIdx = -1;
                input.blur();
            }
        } else if (e.key === 'Escape') {
            results.style.display = 'none';
            selIdx = -1;
            input.value = '';
        }
    });
    results.addEventListener('click', (e) => {
        const item = e.target.closest('.search-item');
        if (!item) return;
        locate(item.dataset.id);
        input.value = '';
        results.style.display = 'none';
        selIdx = -1;
        input.blur();
    });
    // 点击页面其他处收起
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.search-wrap')) {
            results.style.display = 'none';
            selIdx = -1;
        }
    });
}
