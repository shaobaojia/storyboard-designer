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
    const mode = state.viewMode;  // 视图模式变化时强制重建卡片
    return base + '' + frames + '' + expanded + '' + mode;
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
    html += `<button class="stack-badge" onclick="window.__sb.toggleListMulti('${shot.id}');event.stopPropagation();" title="展开/折叠">${frames.length}</button>`;
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
    // v0.9.4 多展开并存：DOM 流式布局中该镜头实际起始列还要加上它前面所有
    // 已展开镜头多占的格位（每个展开镜头占 frames.length 格而非 1 格），
    // 否则后面镜头的行分段（frame-first/frame-row-last）按错误列算 → 底衬断层
    const startIdx = state.shots.findIndex(s => s.id === shot.id);
    let extra = 0;
    if (startIdx > 0) {
        for (let i = 0; i < startIdx; i++) {
            const s = state.shots[i];
            if ((s.frames || []).length > 1 && state.expandedShotIds.has(s.id)) {
                extra += s.frames.length - 1;
            }
        }
    }
    let rowStart = startIdx === -1 ? 0 : (startIdx + extra) % cols;

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
        const isRowHead = i === 0 || rowOf[i] !== rowOf[i - 1];
        const isRowTail = i === frames.length - 1 || rowOf[i] !== rowOf[i + 1];
        const first = i === 0;
        const last = i === frames.length - 1;  // v0.9.4：折叠按钮挂最后一张（左边缘）
        const cls = ['shot-card', 'frame-cell'];
        if (isRowHead) cls.push('frame-first');
        if (isRowTail) cls.push('frame-row-last');
        if (state.selectedIds.has(shot.id)) cls.push('selected');
        // 焦点帧蓝框跟手点击（v0.8.1）：focusedFrameId 属于本镜头才标框；
        // 不属于本镜头（焦点在别的镜头/已清空）→ 无框——同一时间全局只有一个选中框
        // （v0.9.2 定稿；v0.9.4 展开默认焦点=第一帧 focusFirstFrame，此处不再 fallback 封面帧，
        //  否则多展开镜头切视图时每个镜头都渲染出幽灵蓝框）
        const focusId = (state.focusedFrameId && frames.some(fr => fr.id === state.focusedFrameId))
            ? state.focusedFrameId : null;
        const imgCls = [f.isCover ? 'is-cover' : '', f.id === focusId ? 'frame-focused' : '']
            .filter(Boolean).join(' ');
        wrap.innerHTML = `
            <div class="${cls.join(' ')}" draggable="false" data-id="${shot.id}" data-frame-id="${f.id}">
                ${frameImgHtml(f, shot, eager, imgCls)}
                ${f.isCover ? `<div class="cover-chip">封面</div>` : ''}${first ? `<button class="stack-badge expanded-badge" onclick="window.__sb.toggleListMulti('${shot.id}');event.stopPropagation();" title="折叠">${frames.length}</button>` : ''}
                ${last ? '<button class="collapse-btn" title="折叠" data-action="collapse">◀</button>' : ''}
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

// ===== v0.9.5 展开态帧图布局（用户拍板）=====
// 每行独立计算：图宽 W = (行底衬宽 - 9×(行帧数+1)) / 行帧数，
// 行底衬宽 = 行帧数×列宽 + (行帧数-1)×gap（连片视觉宽，含被负 margin 吃掉的 gap）。
// 外沿 = 图间距 = 9px 严格统一（用户拍板 D：外沿 9 优先，跨行时行间图宽允许不同——
// 2+1 跨行的 2 格行图宽 > 1 格行图宽，但每行内图等大、间距/外沿全 9）。
// 图高 = W×9/16 等比例。实现：不重建 DOM、不动格子结构（底衬连片/负 margin/FLIP/
// 拖拽/右键全兼容），每格设 --frame-w 变量 + 每张图 inline margin-left 精确排布。
const FRAME_EDGE = 9;    // 固定间隔：图间距 = 外沿（用户定值）
const GRID_GAP = 12;     // 宫格 gap（与 zoom.js 的 GAP 一致）

function computeExpandedLayout() {
    const shots = state.shots;
    const expanded = shots.filter(s => (s.frames || []).length > 1 && state.expandedShotIds.has(s.id));
    if (expanded.length === 0) return null;
    const colW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-min'));
    if (!colW || colW <= 0) return null;
    const cols = (() => {
        try {
            return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
        } catch { return 1; }
    })();
    // 每镜头的行分段（与 buildExpandedCards 同逻辑：startIdx + 前面展开镜头占位补偿）
    const infos = expanded.map(shot => {
        const frames = shot.frames || [];
        const startIdx = shots.findIndex(s => s.id === shot.id);
        let extra = 0;
        for (let i = 0; i < startIdx; i++) {
            const s = shots[i];
            if ((s.frames || []).length > 1 && state.expandedShotIds.has(s.id)) extra += s.frames.length - 1;
        }
        const rowStart = startIdx === -1 ? 0 : (startIdx + extra) % cols;
        const rowOf = [], rowCounts = [];
        let curRow = 0, colInRow = rowStart;
        frames.forEach((f, i) => {
            if (i > 0 && colInRow >= cols) { curRow++; colInRow = 0; }
            rowOf[i] = curRow;
            rowCounts[curRow] = (rowCounts[curRow] || 0) + 1;
            colInRow++;
        });
        return { shot, frames, rowOf, rowCounts };
    });
    // 每行独立图宽 + 外沿（行内图等大，跨行行间允许不同——用户拍板 D）
    const rowWs = [];
    infos.forEach(info => info.rowCounts.forEach((k, r) => {
        const B = k * colW + (k - 1) * GRID_GAP;
        const W = (B - FRAME_EDGE * (k + 1)) / k;
        if (!isFinite(W) || W <= 0) return;
        rowWs.push({ shotId: info.shot.id, row: r, k, B, W });
    }));
    if (rowWs.length === 0) return null;
    return { colW, infos, rowWs };
}

// 应用展开态布局（渲染后 / 缩放、预览调宽后都调，幂等）：
// 设 --frame-w + 每图 margin-left + 行分段类同步（缩放列数变后差分复用的旧类跟随）
export function applyExpandedLayout() {
    const lay = computeExpandedLayout();
    if (!lay) return;
    const { colW, infos, rowWs } = lay;
    // 行 → {W, E} 映射；外沿 E = 余量对称均分（公式下 ≈ 9，浮点取整误差 ±0.5px）
    const rowMap = {};
    rowWs.forEach(x => {
        rowMap[x.shotId + ':' + x.row] = {
            W: x.W,
            E: (x.B - x.k * x.W - (x.k - 1) * FRAME_EDGE) / 2
        };
    });
    infos.forEach(({ shot, frames, rowOf }) => {
        const cells = grid.querySelectorAll(`.shot-card.frame-cell[data-id="${shot.id}"]`);
        frames.forEach((f, i) => {
            const cell = cells[i];
            if (!cell) return;
            const r = rowOf[i];
            const { W, E } = rowMap[shot.id + ':' + r] || { W: colW - 2 * FRAME_EDGE, E: FRAME_EDGE };
            let j = 0;
            for (let t = 0; t < i; t++) if (rowOf[t] === r) j++;
            // 图左缘（相对行底衬左）= 外沿 + j×(图宽+间距)；格左缘 = j×(列宽+gap)；
            // margin-left = 差值（首图 = 外沿；后续图可能为负 = 相对格子左移，底衬连片内可见）
            const marginLeft = E + j * (W + FRAME_EDGE) - j * (colW + GRID_GAP);
            cell.style.setProperty('--frame-w', W + 'px');
            const img = cell.querySelector('.frame-img');
            if (img) img.style.marginLeft = marginLeft + 'px';
            // 行分段类同步（缩放/预览改列数后，复用 cell 的旧类要跟随新布局）
            const isRowHead = i === 0 || rowOf[i] !== rowOf[i - 1];
            const isRowTail = i === frames.length - 1 || rowOf[i] !== rowOf[i + 1];
            cell.classList.toggle('frame-first', isRowHead);
            cell.classList.toggle('frame-row-last', isRowTail);
        });
    });
}

function buildCard(shot, eager) {
    const sel = state.selectedIds.has(shot.id) ? 'selected' : '';
    const wrap = document.createElement('div');
    if (state.viewMode === 'list') {
        const updated = (shot.updated_at || '').replace('T', ' ').slice(5, 16);
        const content = shot.content || '';
        const dialogue = shot.dialogue || '';
        const frames = shot.frames || [];
        const isMulti = frames.length > 1;
        const expanded = isMulti && state.expandedShotIds.has(shot.id);
        const toggleId = shot.id.replace(/[^a-zA-Z0-9]/g,'');
        const multiBadge = isMulti ? `<button class="multi-badge${expanded ? ' expanded' : ''}" onclick="window.__sb.toggleListMulti('${shot.id}');event.stopPropagation();">${frames.length}帧${expanded ? ' ◀' : ' ▶'}</button>` : '';
        // v0.8.4: 所有镜头折叠态缩略图 = 封面帧图（统一 frames 模型，单图=1 帧镜头；
        // 封面变更立即跟随；thumb.jpg 仅作 legacy 兜底）
        const coverFrame = frames.find(f => f.isCover) || frames[0];
        const thumbHtml = coverFrame && coverFrame.imageUrl
            ? `<img class="shot-thumb" draggable="false" src="${coverFrame.imageUrl}" loading="${eager ? 'eager' : 'lazy'}" onerror="this.src='${SVG_NOIMG}'">`
            : thumbImgHtml(shot, eager);
        // 展开态：封面图保持行高，帧缩略图浮层叠加
        let framesOverlay = '';
        if (expanded) {
            // v0.9.2：列表展开态子帧单焦点（与宫格 frame-focused 同语义）：
            // focusedFrameId 属于本镜头才标框，否则无框——同一时间全局只有一个选中框
            // （v0.9.4 展开默认焦点=第一帧 focusFirstFrame，不 fallback 封面帧，防多展开镜头幽灵蓝框）
            const focusId = (state.focusedFrameId && frames.some(fr => fr.id === state.focusedFrameId))
                ? state.focusedFrameId : null;
            const frameThumbs = frames.map(f => {
                const imgUrl = f.imageUrl || '';
                const cls = [f.isCover ? 'is-cover' : '', f.id === focusId ? 'frame-focused' : '']
                    .filter(Boolean).join(' ');
                return `<div class="frame-thumb ${cls}" data-frame-id="${f.id}" data-frame-no="${f.frame_no}" data-shot-id="${shot.id}">
                    ${imgUrl ? `<img src="${imgUrl}" loading="eager" draggable="false">` : '<div class="frame-missing">f' + f.frame_no + '</div>'}
                </div>`;
            }).join('');
            framesOverlay = `<div class="list-frames">${frameThumbs}${multiBadge}</div>`;
        }
        wrap.innerHTML = `
            <div class="shot-card list-item ${sel}${isMulti ? ' multi' : ''}${expanded ? ' expanded' : ''}" draggable="false" data-id="${shot.id}">
                <div class="thumb-wrap">
                    ${thumbHtml}
                    ${framesOverlay}
                </div>
                <div class="shot-name" data-field="name">${shot.name}${expanded ? '' : multiBadge}</div>
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
                <div class="shot-card multi ${sel}" draggable="false" data-id="${shot.id}">
                    ${stackHtml(shot, eager)}
                    <div class="shot-info">
                        <div class="shot-name" data-field="name">${shot.name}</div>
                        <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                    </div>
                </div>`;
        } else {
            // v0.8.4: 单图 = 1 帧镜头，卡片图统一用封面帧图（与列表/展开态同源）
            const coverFrame = frames.find(f => f.isCover) || frames[0];
            const coverImgHtml = coverFrame && coverFrame.imageUrl
                ? `<img class="shot-thumb" draggable="false" src="${coverFrame.imageUrl}" loading="${eager ? 'eager' : 'lazy'}" onerror="this.src='${SVG_NOIMG}'">`
                : thumbImgHtml(shot, eager);
            wrap.innerHTML = `
                <div class="shot-card ${sel}" draggable="false" data-id="${shot.id}">
                    ${coverImgHtml}
                    <div class="shot-info">
                        <div class="shot-name" data-field="name">${shot.name}</div>
                        <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                    </div>
                </div>`;
        }
    }
    // 用 wrap 返回，让 renderGrid 处理多子元素（列表视图的 list-item + list-frames）
    const key = cardKey(shot);
    for (const child of wrap.children) {
        if (child.dataset) child.dataset.key = key;
    }
    return wrap;
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
    // v0.9.3：差分重建会经过"grid 短暂变空"的中间态（复用节点移入 fragment 再挂回），
    // 浏览器在渲染帧把 scrollY clamp 掉 = 页面跳顶。任务内保存并在末尾恢复滚动位置，
    // 恢复后渲染帧时内容已完整、scrollY 有效，浏览器不再调整。
    const savedScrollY = window.scrollY;
    const oldRects = captureRects();
    const isList = state.viewMode === 'list';
    // v0.9.4：增量维护 class——整体重设 className 会冲掉其它模块挂的 class
    // （预览框的 preview-on/preview-right/preview-left，展开多图 renderGrid 后预览布局丢）
    grid.classList.toggle('list-mode', isList);
    document.getElementById('listHeader').classList.toggle('on', isList && state.shots.length > 0);

    if (state.shots.length === 0) {
        // 空态：必须先揭掉骨架层，否则提示被盖住 = 卡骨架屏（v0.8.2）
        removeSkeleton();
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
        const produced = isExpandedMulti ? buildExpandedCards(shot, true) : [...buildCard(shot, state.firstLoadDone ? true : idx < eagerCount).children];

        for (const el of produced) {
            const reuseKey = el.dataset.frameId ? `${el.dataset.id}:${el.dataset.frameId}` : el.dataset.id;
            const oldEl = existing.get(reuseKey);
            // 复用条件：差分键一致 且 卡片里没有残留输入框（编辑会话的安全网）
            if (oldEl && oldEl.dataset.key === key && !oldEl.querySelector('input')) {
                existing.delete(reuseKey);
                oldEl.classList.toggle('selected', state.selectedIds.has(shot.id));
                // v0.9.4 展开态底衬跟随重排：其它镜头展开/折叠会改变本镜头的
                // 实际行分段（换行），行首/行尾 class 必须按新分段重算，
                // 否则底衬按旧分段画 → 同镜头帧格间 12px 断层
                if (el.classList.contains('frame-first')) oldEl.classList.add('frame-first');
                else oldEl.classList.remove('frame-first');
                if (el.classList.contains('frame-row-last')) oldEl.classList.add('frame-row-last');
                else oldEl.classList.remove('frame-row-last');
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
    // v0.9.3：empty-state（初始 "Loading shots..."）不参与 .shot-card 差分，
    // 删 grid.innerHTML='' 后必须显式移除，否则残留 = 宫格左上角/列表第一行永远挂占位提示。
    // （空态提示只在 shots=0 分支通过 innerHTML 重建，此处 shots>0，移除安全）
    const staleEmpty = grid.querySelector('.empty-state');
    if (staleEmpty) staleEmpty.remove();
    // v0.9.3：不能 grid.innerHTML = '' —— 清空滚动内容会让浏览器同步把 scrollY clamp 到 0
    // （同一任务内立即重建也不恢复），展开/折叠/任何 renderGrid 都会把页面弹回顶部。
    // 差分语义已由 existing.remove + fragment.append 完整覆盖（旧节点要么被复用移入
    // fragment，要么被 remove，grid 此时已无残留），无需全量清空。
    grid.appendChild(fragment);
    // v0.9.5：展开态帧图等大布局（--frame-w + margin-left）——必须在 FLIP 测量前应用，
    // 否则动画从旧图宽的位置起飞；差分复用路径也靠这里重算（列宽/列数变化后）
    applyExpandedLayout();

    // 首屏门控：首屏缩略图就位后波浪式揭幕 (#1)
    if (!state.firstLoadDone) {
        state.firstLoadDone = true;
        gateFirstReveal();
    } else {
        // 新出现/有变化的卡片：淡入 + 缩略图加载完再淡显
        newCards.forEach(el => {
            if (state.animatingShots.has(el.dataset.id)) return;  // 弹簧编排接管中，别播入场
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
        // v0.9.2 视图切换中心扩散：viewSpreadId 设置时，FLIP 起点统一收敛到选中项
        // 位置再向外扩散——先定位后，视觉上卡片从选中项向四周炸开（丝滑过渡）
        const spreadId = state.viewSpreadId;
        state.viewSpreadId = null;  // 一次性消费
        let spreadCenter = null;
        if (spreadId) {
            const el = grid.querySelector(`.shot-card[data-id="${spreadId}"]`);
            if (el) spreadCenter = { left: el.offsetLeft + el.offsetWidth / 2, top: el.offsetTop + el.offsetHeight / 2 };
        }
        animateFrom(oldRects, spreadCenter);
    }
    updateStats();
    // v0.9.3：恢复滚动位置（见函数头注释）——浏览器在 grid 空中间态的渲染帧把 scrollY
    // clamp 掉了（跳顶/跳到 674 类值），这里同步滚回原值；此时内容已完整，scrollY 有效，
    // 浏览器渲染帧不会再调整。首屏（scrollY=0）与 FLIP 起点帧不受影响。
    if (window.scrollY !== savedScrollY) window.scrollTo(0, savedScrollY);
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
// 键必须与 renderGrid 复用键一致（v0.8.1）：展开态 N 个帧格共享 dataset.id，
// 只按 id 存 rect 会互相覆盖——任何排序都让帧格从错误位置起飞（"多图自己滑一下"的根因）
// 测量用 offsetLeft/offsetTop 而非 getBoundingClientRect（v0.8.1）：
// offset* 是纯布局值，不受 transform 影响——上一轮未播完的 FLIP invert / 进行中的
// transition 不会污染下一轮捕获（getBoundingClientRect 含 transform，会连环污染）
// spreadCenter 非空（v0.9.2 视图切换）：所有卡片起点收敛到该中心（选中项）再向外
// 扩散——卡片 transform 从中心偏移到自身新位置，视觉上以选中项为中心炸开
function rectKeyOf(el) {
    return el.dataset.frameId ? `${el.dataset.id}:${el.dataset.frameId}` : el.dataset.id;
}

function captureRects() {
    const map = new Map();
    document.querySelectorAll('.shot-card').forEach(c => {
        map.set(rectKeyOf(c), { left: c.offsetLeft, top: c.offsetTop });
    });
    return map;
}

function animateFrom(oldRects, spreadCenter = null) {
    if (!oldRects || !oldRects.size) return;
    document.querySelectorAll('.shot-card').forEach(c => {
        if (state.animatingShots.has(c.dataset.id)) return;  // 弹簧编排接管中，FLIP 让位
        let dx, dy;
        if (spreadCenter) {
            // 中心扩散模式：起点 = 从选中项中心出发
            dx = spreadCenter.left - (c.offsetLeft + c.offsetWidth / 2);
            dy = spreadCenter.top - (c.offsetTop + c.offsetHeight / 2);
        } else {
            const old = oldRects.get(rectKeyOf(c));
            if (!old) return;
            dx = old.left - c.offsetLeft;
            dy = old.top - c.offsetTop;
        }
        if (!dx && !dy) return;
        c.style.transition = 'none';
        c.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
            c.style.transition = '';
            c.style.transform = '';
        });
    });
}

// 右下角统计 (#8) + 垃圾桶模式标题同步 (#3) + 标题栏总镜数/总时长 (v0.9.5)
// 标题统一在此渲染：避免各处 innerText/textContent 赋值清掉 statsBar 子节点
export function updateStats() {
    document.getElementById('statTotal').textContent = state.shots.length;
    document.getElementById('statSel').textContent = state.selectedIds.size;
    const pt = document.getElementById('pageTitle');
    if (!pt) return;
    const title = state.trashMode ? `垃圾桶 · ${state.shots.length}` : (state.projectTitle || 'Storyboard Grid');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    pt.innerHTML = esc(title) + '<span id="statsBar" class="stats-bar"></span>';
    const totalSec = state.shots.reduce((a, s) => a + (Number(s.duration) || 0), 0);
    const mm = Math.floor(totalSec / 60);
    const ss = Math.round(totalSec % 60);
    pt.querySelector('#statsBar').textContent = `总镜数 ${state.shots.length} 总时长 ${mm}′${String(ss).padStart(2, '0')}″`;
}

// 视图切换（v0.9.2 丝滑过渡）：先定位到选中项，再以选中项为中心向外扩散 FLIP
export function toggleView() {
    state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('sb-view', state.viewMode);
    syncViewToggleButton();
    grid.querySelectorAll('.shot-card').forEach(el => { el.dataset.key = ''; });
    const selId = [...state.selectedIds][0] || null;
    state.viewSpreadId = selId;  // 扩散 FLIP 中心（renderGrid 内部消费后清空）
    renderGrid();
    // 刷新缩放滑块（列表/宫格各自的范围不同）
    if (window.__zoomApply) window.__zoomApply();
    // 先定位：立即滚到选中镜头（scrollIntoView 按布局位置，不受 FLIP transform 影响；
    // FLIP 用 offset* 计算同样不受滚动影响，定位与扩散互不干扰）
    if (selId) {
        const card = grid.querySelector(`.shot-card[data-id="${selId}"]`);
        if (card) card.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
}

export function syncViewToggleButton() {
    const btn = document.getElementById('viewToggle');
    btn.textContent = state.viewMode === 'grid' ? '列表视图' : '宫格视图';
    btn.classList.toggle('active-view', state.viewMode === 'list');
}
