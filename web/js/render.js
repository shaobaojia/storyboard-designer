// 渲染：宫格/列表两种视图 + FLIP 动效
import { state, grid } from './state.js';

export function thumbHtml(shot, cls) {
    return shot.thumb_path
        ? `<img class="${cls}" src="/shots/${shot.name}_${shot.id}/thumb.jpg?v=${encodeURIComponent(shot.updated_at || '')}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%23333%22 width=%22320%22 height=%22180%22/><text fill=%22%23666%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22>No image</text></svg>'">`
        : `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;color:#666;">No render</div>`;
}

export function renderGrid() {
    const oldRects = captureRects();
    grid.className = state.viewMode === 'list' ? 'grid list-mode' : 'grid';

    if (state.shots.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No shots yet. Create one in Blender.</p></div>';
        return;
    }

    grid.innerHTML = state.shots.map(shot => {
        const sel = state.selectedIds.has(shot.id) ? 'selected' : '';
        if (state.viewMode === 'list') {
            const updated = (shot.updated_at || '').replace('T', ' ').slice(5, 16);
            return `
                <div class="shot-card list-item ${sel}" draggable="true" data-id="${shot.id}">
                    ${thumbHtml(shot, 'shot-thumb')}
                    <div class="shot-info">
                        <div class="shot-name">${shot.name}</div>
                        <div class="shot-meta">${shot.duration.toFixed(1)}s</div>
                        <div class="shot-updated">${updated}</div>
                    </div>
                </div>`;
        }
        return `
                <div class="shot-card ${sel}" draggable="true" data-id="${shot.id}">
                    ${thumbHtml(shot, 'shot-thumb')}
                    <div class="shot-info">
                        <div class="shot-name">${shot.name}</div>
                        <div class="shot-meta">${shot.duration.toFixed(1)}s</div>
                    </div>
                </div>`;
    }).join('');

    animateFrom(oldRects);
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

// 视图切换
export function toggleView() {
    state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('sb-view', state.viewMode);
    syncViewToggleButton();
    renderGrid();
}

export function syncViewToggleButton() {
    const btn = document.getElementById('viewToggle');
    btn.textContent = state.viewMode === 'grid' ? '列表视图' : '宫格视图';
    btn.classList.toggle('active-view', state.viewMode === 'list');
}
