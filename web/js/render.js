// 渲染：宫格/列表两种视图 + FLIP 动效 + DOM 差分 + 骨架屏首屏门控
import { state, grid } from './state.js';

// 差分键：只放"内容字段"。updated_at 故意不在里面——排序/改文本不该重建卡片；
// 图片是否重载由 thumb_ver 独立决定（只有拍屏完成才递增）
const KEY_FIELDS = ['name', 'duration', 'content', 'dialogue', 'thumb_ver'];

function cardKey(shot) {
    const base = KEY_FIELDS.map(k => shot[k] ?? '').join('');
    // 多图镜头：帧列表（id+imageUrl+isCover）进差分键，帧变了才重建
    const frames = (shot.frames || []).map(f => `${f.id}:${f.imageUrl}:${f.isCover}`).join('');
    const expanded = state.expandedShotIds.has(shot.id) ? 'X' : '';
    return base + '' + frames + '' + expanded;
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

// ---- 多图镜头（v0.7.0）----
const SVG_NOIMG = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%23333%22 width=%22320%22 height=%22180%22/><text fill=%22%23666%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22>No image</text></svg>`;

function frameImgHtml(frame, shot, eager, extraClass = '') {
    const load = eager ? 'eager' : 'lazy';
    if (frame.imageUrl) {
        return `<img class="frame-img ${extraClass}" draggable="false" data-frame-id="${frame.id}" data-frame-no="${frame.frame_no}" src="${frame.imageUrl}" loading="${load}" onerror="this.src='${SVG_NOIMG}'">`;
    }
    // 红格子：数据在但图片缺失/加载失败
    return `<div class="frame-img frame-missing ${extraClass}" data-frame-id="${frame.id}" data-frame-no="${frame.frame_no}" title="帧 ${frame.frame_no} 缺图，右键重拍"><span class="missing-no">f${frame.frame_no}</span></div>`;
}

// 折叠态一叠牌：N 张图叠放，封面在顶，后续图错位露边（最多露 3 层）
function stackHtml(shot, eager) {
    const frames = shot.frames || [];
    const cover = frames.find(f => f.isCover) || frames[0];
    const others = frames.filter(f => f !== cover).slice(0, 3);  // 只露 3 层
    let html = '<div class="frame-stack">';
    // 底层错位牌（先渲染的在最下）
    others.forEach((f, i) => {
        const depth = others.length - i;  // 越靠后越贴近封面
        html += frameImgHtml(f, shot, eager, `stack-layer layer-${depth}`);
    });
    // 封面在顶
    if (cover) html += frameImgHtml(cover, shot, eager, 'cover');
    html += `<div class="stack-badge">${frames.length}</div>`;
    html += '</div>';
    return html;
}

// 展开态：一个 shot 渲染 N 个格位（帧格），底衬按行分段（每行一个实例，
// 跨行时次行自动出现对应宽度的底衬，不跨行时只有一个）
// 返回元素数组（renderGrid 逐个 append 进 fragment）
function buildExpandedCards(shot, eager) {
    const frames = shot.frames || [];
    const cards = [];

    // 当前宫格列数（与 zoom.js 的列数反算一致），用于判断展开后每行装几帧
    const cols = (() => {
        try {
            return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
        } catch { return 1; }
    })();

    // 展开的起始位置 = 该 shot 在 shots 数组里的索引 → 决定第一行能放几帧
    // （流式布局下，展开的第一个格位 = 折叠态卡片所在位置）
    // 逐帧分配行号：第一行剩余位置 = cols - (startIdx % cols)，之后每行 cols 个
    const startIdx = state.shots.findIndex(s => s.id === shot.id);
    let rowStart = startIdx === -1 ? 0 : startIdx % cols;

    // 计算每帧的行号 + 该行内的帧数（用于底衬宽度）
    const rowOf = [];      // 每帧的行号
    const rowCounts = [];  // 每行的帧数
    let curRow = 0;
    let colInRow = rowStart;
    frames.forEach((f, i) => {
        if (i > 0 && colInRow >= cols) { curRow++; colInRow = 0; }
        rowOf[i] = curRow;
        rowCounts[curRow] = (rowCounts[curRow] || 0) + 1;
        colInRow++;
    });

    frames.forEach((f, i) => {
        const wrap = document.createElement('div');
        const isRowHead = i === 0 || rowOf[i] !== rowOf[i - 1];  // 每行第一格挂底衬
        const first = i === 0;
        const span = rowCounts[rowOf[i]];
        wrap.innerHTML = `
            <div class="shot-card frame-cell ${first ? 'frame-first' : ''}" draggable="true" data-id="${shot.id}" data-frame-id="${f.id}">
                ${isRowHead ? `<div class="frame-backing" style="--span:${span}"></div>` : ''}
                ${frameImgHtml(f, shot, eager, f.isCover ? 'is-cover' : '')}
                <div class="shot-info">
                    ${first ? `<div class="shot-name" data-field="name">${shot.name}</div>` : `<div class="frame-no">f${f.frame_no}</div>`}
                    ${first ? `<div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>` : ''}
                </div>
            </div>`;
        const el = wrap.firstElementChild;
        el.dataset.key = cardKey(shot);
        cards.push(el);
    });
    return cards;
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
        const frames = shot.frames || [];
        const isMulti = frames.length > 1;
        const expanded = state.expandedShotIds.has(shot.id);
        // #8: 宫格的时长也可以双击就地编辑
        if (isMulti && !expanded) {
            // 折叠态多图：一叠牌
            wrap.innerHTML = `
                <div class="shot-card multi ${sel}" draggable="true" data-id="${shot.id}">
                    ${stackHtml(shot, eager)}
                    <div class="shot-info">
                        <div class="shot-name" data-field="name">${shot.name}</div>
                        <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                    </div>
                </div>`;
        } else {
            wrap.innerHTML = `
                <div class="shot-card ${sel}" draggable="true" data-id="${shot.id}">
                    ${thumbImgHtml(shot, eager)}
                    <div class="shot-info">
                        <div class="shot-name" data-field="name">${shot.name}</div>
                        <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                    </div>
                </div>`;
        }
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
    // 展开态多图：一个 shot 渲染 N 个格位，复用键 = shotId 或 shotId:frameId
    const existing = new Map();
    grid.querySelectorAll('.shot-card').forEach(el => {
        const key = el.dataset.frameId ? `${el.dataset.id}:${el.dataset.frameId}` : el.dataset.id;
        existing.set(key, el);
    });

    const eagerCount = screenCardCount(3);
    const fragment = document.createDocumentFragment();
    const newCards = [];
    let idx = 0;
    for (const shot of state.shots) {
        const key = cardKey(shot);
        const isExpandedMulti = state.viewMode !== 'list' &&
            (shot.frames || []).length > 1 && state.expandedShotIds.has(shot.id);

        // 展开态：一个 shot 产 N 个格位，逐个走复用/重建
        const produced = isExpandedMulti ? buildExpandedCards(shot, true) : [buildCard(shot, state.firstLoadDone ? true : idx < eagerCount)];

        for (const el of produced) {
            const reuseKey = el.dataset.frameId ? `${el.dataset.id}:${el.dataset.frameId}` : el.dataset.id;
            const oldEl = existing.get(reuseKey);
            // 复用条件：差分键一致 且 卡片里没有残留输入框（编辑会话的安全网）
            if (oldEl && oldEl.dataset.key === key && !oldEl.querySelector('input')) {
                existing.delete(reuseKey);
                oldEl.classList.toggle('selected', state.selectedIds.has(shot.id));
                fragment.appendChild(oldEl);
                continue;
            }
            // 卡片被强制重建时，若它正挂着输入框，说明编辑会话已被打断，解锁编辑态
            if (oldEl && oldEl.querySelector('input') && state.editingId === shot.id) {
                state.editingId = null;
            }
            if (oldEl) {
                // img 移植：src 没变就把加载好的旧 img 直接挪过来，零闪烁；
                // src 变了（新拍屏）只给新 img 做透明度渐变，卡片本身不动
                const oldImg = oldEl.querySelector('img.shot-thumb, img.frame-img.cover, img.frame-img');
                const newImg = el.querySelector('img.shot-thumb, img.frame-img.cover, img.frame-img');
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
            fragment.appendChild(el);
        }
        idx++;
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
            // 入场播完立刻摘类——类留着的话，下次重排 DOM 动画会重播 = 闪黑 (#R6-1)
            el.addEventListener('animationend', () => el.classList.remove('fade-in'), {once: true});
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
        // 播完清掉延迟和类：类不摘的话，卡片下次重排 DOM 会重播入场 = 全屏闪黑 (#R6-1)
        setTimeout(() => {
            cards.forEach(el => { el.style.animationDelay = ''; el.classList.remove('fade-in'); });
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
