// 渲染：宫格/列表两种视图 + FLIP 动效 + DOM 差分 + 首屏加载门控
import { state, grid } from './state.js';

// 差分键：这些字段没变就复用旧 DOM（缩略图不重载，告别噼里啪啦）
const KEY_FIELDS = ['name', 'duration', 'content', 'dialogue', 'updated_at', 'thumb_path'];

function cardKey(shot) {
    return KEY_FIELDS.map(k => shot[k] ?? '').join('');
}

function thumbImgHtml(shot) {
    return shot.thumb_path
        ? `<img class="shot-thumb" draggable="false" src="/shots/${shot.name}_${shot.id}/thumb.jpg?v=${encodeURIComponent(shot.updated_at || '')}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%23333%22 width=%22320%22 height=%22180%22/><text fill=%22%23666%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22>No image</text></svg>'">`
        : `<div class="shot-thumb" style="display:flex;align-items:center;justify-content:center;color:#666;">No render</div>`;
}

function buildCard(shot) {
    const sel = state.selectedIds.has(shot.id) ? 'selected' : '';
    const wrap = document.createElement('div');
    if (state.viewMode === 'list') {
        const updated = (shot.updated_at || '').replace('T', ' ').slice(5, 16);
        const content = shot.content || '';
        const dialogue = shot.dialogue || '';
        wrap.innerHTML = `
            <div class="shot-card list-item ${sel}" draggable="true" data-id="${shot.id}">
                ${thumbImgHtml(shot)}
                <div class="shot-name" data-field="name">${shot.name}</div>
                <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                <div class="cell-text cell-edit ${content ? '' : 'empty'}" data-field="content">${content || '内容…'}</div>
                <div class="cell-text cell-edit ${dialogue ? '' : 'empty'}" data-field="dialogue">${dialogue || '台词…'}</div>
                <div class="shot-updated">${updated}</div>
            </div>`;
    } else {
        wrap.innerHTML = `
            <div class="shot-card ${sel}" draggable="true" data-id="${shot.id}">
                ${thumbImgHtml(shot)}
                <div class="shot-info">
                    <div class="shot-name" data-field="name">${shot.name}</div>
                    <div class="shot-meta">${shot.duration.toFixed(1)}s</div>
                </div>
            </div>`;
    }
    const el = wrap.firstElementChild;
    el.dataset.key = cardKey(shot);
    return el;
}

export function renderGrid() {
    const oldRects = captureRects();
    const isList = state.viewMode === 'list';
    grid.className = isList ? 'grid list-mode' : 'grid';
    document.getElementById('listHeader').classList.toggle('on', isList && state.shots.length > 0);

    if (state.shots.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No shots yet. Create one in Blender.</p></div>';
        updateStats();
        return;
    }

    // DOM 差分：按 id 复用未变化的卡片，只重建变了的
    const existing = new Map();
    grid.querySelectorAll('.shot-card').forEach(el => existing.set(el.dataset.id, el));

    const fragment = document.createDocumentFragment();
    const newCards = [];
    for (const shot of state.shots) {
        const key = cardKey(shot);
        let el = existing.get(shot.id);
        // 复用条件：差分键一致 且 卡片里没有残留输入框（编辑会话的安全网）
        if (el && el.dataset.key === key && !el.querySelector('input')) {
            existing.delete(shot.id);
            el.classList.toggle('selected', state.selectedIds.has(shot.id));
        } else {
            // 卡片被强制重建时，若它正挂着输入框，说明编辑会话已被打断，解锁编辑态
            if (el && el.querySelector('input') && state.editingId === shot.id) {
                state.editingId = null;
            }
            el = buildCard(shot);
            newCards.push(el);
        }
        fragment.appendChild(el);
    }
    existing.forEach(el => el.remove());  // 已删除的镜头
    grid.innerHTML = '';
    grid.appendChild(fragment);

    // 首屏门控：等全部缩略图就位再统一刷出 (#16)
    if (!state.firstLoadDone) {
        state.firstLoadDone = true;
        gateFirstReveal();
    } else {
        // 新出现/有变化的卡片：淡入 + 缩略图加载完再淡显
        newCards.forEach(el => {
            el.classList.add('fade-in');
            const img = el.querySelector('img.shot-thumb');
            if (img && !img.complete) {
                img.style.opacity = '0';
                img.style.transition = 'opacity 0.3s';
                const show = () => { img.style.opacity = '1'; };
                img.addEventListener('load', show, { once: true });
                img.addEventListener('error', show, { once: true });
            }
        });
        animateFrom(oldRects);
    }
    updateStats();
}

function gateFirstReveal() {
    const bar = document.getElementById('loadBar');
    const imgs = [...grid.querySelectorAll('img.shot-thumb')];
    const total = Math.max(imgs.length, 1);
    let settled = 0;
    let finished = false;
    grid.classList.add('preload');

    const finish = () => {
        if (finished) return;
        finished = true;
        bar.style.width = '100%';
        grid.classList.remove('preload');
        grid.querySelectorAll('.shot-card').forEach(el => el.classList.add('fade-in'));
        setTimeout(() => { bar.style.transition = 'opacity 0.4s'; bar.style.opacity = '0'; }, 350);
        setTimeout(() => { bar.style.display = 'none'; }, 800);
    };
    const tick = () => {
        if (finished) return;
        settled++;
        bar.style.width = Math.round(settled / total * 92) + '%';
        if (settled >= total) finish();
    };
    if (!imgs.length) { finish(); return; }
    imgs.forEach(img => {
        if (img.complete) { tick(); return; }
        img.addEventListener('load', tick, { once: true });
        img.addEventListener('error', tick, { once: true });
    });
    setTimeout(finish, 5000);  // 兜底：慢图不挡门
}

// FLIP 动效：记录旧位置 → 渲染后 invert → 播放到新位置
function captureRects() {
    const map = new Map();
    document.querySelectorAll('.shot-card').forEach(c => {
        map.set(c.dataset.id, c.getBoundingClientRect());
    });
    return map;
}

function animateFrom(oldRects) {
    if (!oldRects || !oldRects.size) return;
    document.querySelectorAll('.shot-card').forEach(c => {
        const old = oldRects.get(c.dataset.id);
        if (!old) return;
        const now = c.getBoundingClientRect();
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (!dx && !dy) return;
        c.style.transition = 'none';
        c.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
            c.style.transition = '';
            c.style.transform = '';
        });
    });
}

// 右下角统计 (#8)
export function updateStats() {
    document.getElementById('statTotal').textContent = state.shots.length;
    document.getElementById('statSel').textContent = state.selectedIds.size;
}

// 视图切换
export function toggleView() {
    state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('sb-view', state.viewMode);
    syncViewToggleButton();
    // 两种视图的卡片结构不同，差分键挡不住，强制全量重建
    grid.querySelectorAll('.shot-card').forEach(el => { el.dataset.key = ''; });
    renderGrid();
}

export function syncViewToggleButton() {
    const btn = document.getElementById('viewToggle');
    btn.textContent = state.viewMode === 'grid' ? '列表视图' : '宫格视图';
    btn.classList.toggle('active-view', state.viewMode === 'list');
}
