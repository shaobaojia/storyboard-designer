// 渲染：宫格/列表两种视图 + FLIP 动效 + DOM 差分 + 骨架屏首屏门控
import { state, grid } from './state.js';

// 差分键：只放"内容字段"。updated_at 故意不在里面——排序/改文本不该重建卡片；
// 图片是否重载由 thumb_ver 独立决定（只有拍屏完成才递增）
const KEY_FIELDS = ['name', 'duration', 'content', 'dialogue', 'thumb_ver'];

function cardKey(shot) {
    return KEY_FIELDS.map(k => shot[k] ?? '').join('');
}

// 首屏预载窗口：前 3 屏 eager，更远处 lazy（#2/#16）
function screenCardCount(screens) {
    const cardMin = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--card-min')) || 200;
    const cols = state.viewMode === 'list'
        ? 1
        : Math.max(1, Math.floor(window.innerWidth / (cardMin + 12)));
    const cardH = state.viewMode === 'list' ? 60 : (cardMin * 9 / 16 + 60);
    const rows = Math.max(1, Math.ceil(window.innerHeight / cardH));
    return cols * rows * screens;
}

function thumbImgHtml(shot, eager) {
    const load = eager ? 'eager' : 'lazy';
    return shot.thumb_path
        ? `<img class="shot-thumb" draggable="false" src="/shots/${shot.name}_${shot.id}/thumb.jpg?v=${shot.thumb_ver || 0}" loading="${load}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%23333%22 width=%22320%22 height=%22180%22/><text fill=%22%23666%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22>No image</text></svg>'">`
        : `<div class="shot-thumb" style="display:flex;align-items:center;justify-content:center;color:#666;">No render</div>`;
}

function buildCard(shot, eager) {
    const sel = state.selectedIds.has(shot.id) ? 'selected' : '';
    const wrap = document.createElement('div');
    if (state.viewMode === 'list') {
        const updated = (shot.updated_at || '').replace('T', ' ').slice(5, 16);
        const content = shot.content || '';
        const dialogue = shot.dialogue || '';
        wrap.innerHTML = `
            <div class="shot-card list-item ${sel}" draggable="true" data-id="${shot.id}">
                ${thumbImgHtml(shot, eager)}
                <div class="shot-name" data-field="name">${shot.name}</div>
                <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                <div class="cell-text cell-edit ${content ? '' : 'empty'}" data-field="content">${content || '内容…'}</div>
                <div class="cell-text cell-edit ${dialogue ? '' : 'empty'}" data-field="dialogue">${dialogue || '台词…'}</div>
                <div class="shot-updated">${updated}</div>
            </div>`;
    } else {
        // #8: 宫格的时长也可以双击就地编辑
        wrap.innerHTML = `
            <div class="shot-card ${sel}" draggable="true" data-id="${shot.id}">
                ${thumbImgHtml(shot, eager)}
                <div class="shot-info">
                    <div class="shot-name" data-field="name">${shot.name}</div>
                    <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                </div>
            </div>`;
    }
    const el = wrap.firstElementChild;
    el.dataset.key = cardKey(shot);
    return el;
}

// 骨架屏 (#1/#3)：独立覆盖层盖在真实宫格上，揭幕时交叉淡化，全程无黑屏
export function showSkeleton() {
    const n = Math.min(screenCardCount(3), 90);
    const layer = document.createElement('div');
    layer.id = 'skelLayer';
    for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.className = 'skel-card';
        d.innerHTML = '<div class="skel-thumb"></div><div class="skel-line"></div>';
        layer.appendChild(d);
    }
    document.getElementById('gridWrap').appendChild(layer);
}

function removeSkeleton() {
    const layer = document.getElementById('skelLayer');
    if (!layer) return;
    layer.classList.add('out');
    setTimeout(() => layer.remove(), 420);
}

export function renderGrid() {
    const oldRects = captureRects();
    const isList = state.viewMode === 'list';
    grid.className = isList ? 'grid list-mode' : 'grid';
    document.getElementById('listHeader').classList.toggle('on', isList && state.shots.length > 0);

    if (state.shots.length === 0) {
        grid.innerHTML = state.trashMode
            ? '<div class="empty-state"><p>垃圾桶是空的</p></div>'
            : '<div class="empty-state"><p>No shots yet. Create one in Blender.</p></div>';
        updateStats();
        return;
    }

    // DOM 差分：按 id 复用未变化的卡片，只重建变了的
    const existing = new Map();
    grid.querySelectorAll('.shot-card').forEach(el => existing.set(el.dataset.id, el));

    const eagerCount = screenCardCount(3);
    const fragment = document.createDocumentFragment();
    const newCards = [];
    let idx = 0;
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
            const oldEl = el;  // 已有卡片重建 = 静默换脸，绝不再放 fade-in (#2)
            el = buildCard(shot, state.firstLoadDone ? true : idx < eagerCount);
            if (oldEl) {
                // img 移植：src 没变就把加载好的旧 img 直接挪过来，零闪烁；
                // src 变了（新拍屏）只给新 img 做透明度渐变，卡片本身不动
                const oldImg = oldEl.querySelector('img.shot-thumb');
                const newImg = el.querySelector('img.shot-thumb');
                if (oldImg && newImg) {
                    if (newImg.src === oldImg.src && oldImg.complete) {
                        newImg.replaceWith(oldImg);
                    } else if (newImg.src !== oldImg.src) {
                        newImg.style.opacity = '0';
                        newImg.style.transition = 'opacity 0.25s';
                        const show = () => { newImg.style.opacity = '1'; };
                        if (newImg.complete) show();
                        else {
                            newImg.addEventListener('load', show, { once: true });
                            newImg.addEventListener('error', show, { once: true });
                        }
                    }
                }
            } else {
                newCards.push(el);  // 只有真正新来的卡片才播入场动画
            }
        }
        idx++;
        fragment.appendChild(el);
    }
    existing.forEach(el => el.remove());  // 已删除/移出当前视图的镜头
    grid.innerHTML = '';
    grid.appendChild(fragment);

    // 首屏门控：首屏缩略图就位后波浪式揭幕 (#1)
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
    const firstScreen = screenCardCount(1);
    const cards = [...grid.querySelectorAll('.shot-card')];
    const imgs = cards.slice(0, firstScreen)
        .map(c => c.querySelector('img.shot-thumb')).filter(Boolean);
    const total = Math.max(imgs.length, 1);
    let settled = 0;
    let finished = false;
    // 真实卡片不再隐身——骨架层盖在上面，揭幕时两层交叉淡化，无黑屏 (#3)

    const finish = () => {
        if (finished) return;
        finished = true;
        removeSkeleton();  // 骨架层淡出 350ms，下面真实卡片同步波浪入场
        // 波浪式错峰入场：每张卡片延迟 25ms 递增（上限 700ms）
        cards.forEach((el, i) => {
            el.style.animationDelay = `${Math.min(i * 25, 700)}ms`;
            el.classList.add('fade-in');
        });
        // 播完清掉延迟，避免影响后续 FLIP/悬停动画
        setTimeout(() => {
            cards.forEach(el => { el.style.animationDelay = ''; });
        }, 1400);
    };
    const tick = () => {
        if (finished) return;
        settled++;
        if (settled >= total) finish();
    };
    if (!imgs.length) { finish(); return; }
    imgs.forEach(img => {
        if (img.complete) { tick(); return; }
        img.addEventListener('load', tick, { once: true });
        img.addEventListener('error', tick, { once: true });
    });
    setTimeout(finish, 4000);  // 兜底：慢图不挡门
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

// 右下角统计 (#8) + 垃圾桶模式标题同步 (#3)
export function updateStats() {
    document.getElementById('statTotal').textContent = state.shots.length;
    document.getElementById('statSel').textContent = state.selectedIds.size;
    if (state.trashMode) {
        document.getElementById('pageTitle').textContent = `垃圾桶 · ${state.shots.length}`;
    }
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
