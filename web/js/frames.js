// 多图镜头：展开/折叠状态 + 交互入口
// 契约（v0.9.0 第二轮）：
//   双击展开态帧格 = 跳回该构图
//   双击折叠态多图 = 展开
//   空格 = 展开/折叠
//   回车/右键 = 打开 Blender
// 状态：展开是视图态，不写库，刷新恢复全折叠
import { state, grid } from './state.js';
import { postShotAction } from './data.js';
import { renderGrid } from './render.js';
import { updatePreview } from './preview.js';

// expandedShotIds 挂在 state 上（state.js 初始化 Set），此处只做读写

// v0.9.45：展开状态按视图分流——时间线用 expandedShotIdsTl（与宫格/列表分开，互不同步），
// 其余视图用 expandedShotIds。menu/keyboard/main 全部走 isExpanded/toggleExpand，分流后自动生效
function expandedSet() {
    return state.viewMode === 'timeline' ? state.expandedShotIdsTl : state.expandedShotIds;
}

export function isExpanded(shotId) {
    return expandedSet().has(shotId);
}

export function toggleExpand(shotId) {
    const s = expandedSet();
    if (s.has(shotId)) s.delete(shotId);
    else s.add(shotId);
}

export function collapseAll() {
    state.expandedShotIds.clear();
}

// ---- 展开/收起弹簧动效编排（v0.8.0，招牌时刻）----
// 展开 = 折叠卡"弹开"成一排帧格；收起 = 帧格逐张"飞回"一叠牌。
// 动画期间 shotId 挂进 state.animatingShots，renderGrid 的 FLIP 和
// fade-in 会跳过这些卡片（见 render.js），transform 全由这里接管。
// 后台标签页 rAF/setTimeout 被冻结时视觉降级为瞬时切换，结构不受影响。

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const _animToken = new Map();  // shotId -> 代数：快速连点时旧定时器不得清掉新动画

function _nextToken(shotId) {
    const t = (_animToken.get(shotId) || 0) + 1;
    _animToken.set(shotId, t);
    return t;
}

function _frameCells(shotId) {
    return [...grid.querySelectorAll(`.shot-card.frame-cell[data-id="${shotId}"]`)];
}

function _clearCellStyle(cell) {
    cell.style.transition = '';
    cell.style.transform = '';
    cell.style.opacity = '';
    cell.style.transformOrigin = '';
    cell.style.zIndex = '';
}

// 展开/折叠焦点（v0.9.4）：展开后焦点落第一帧（frame_no 最小）——预览窗口按顺序看图时
// 从本镜头第一帧衔接到下一个镜头；预览同步刷新到该帧
function focusFirstFrame(shotId) {
    const shot = state.shots.find(s => s.id === shotId);
    const fr = (shot && shot.frames) || [];
    if (fr.length > 0) {
        focusFrame(shotId, fr[0].id);
        updatePreview();
    }
}

// 展开：先抓折叠卡 rect 作 origin，toggle+render 后让每个帧格从 origin
// 缩弹回自己的格位（逐格错峰 40ms）
export function expandAnimated(shotId) {
    if (state.viewMode === 'timeline') {
        // v0.9.45：时间线展开——帧格从折叠 clip 中心向各自格位弹簧展开（错峰 40ms，宫格同款曲线）
        const token = _nextToken(shotId);
        const collapsed = grid.querySelector(`.timeline-clip[data-id="${shotId}"]`);
        const originCx = collapsed
            ? collapsed.getBoundingClientRect().left + collapsed.getBoundingClientRect().width / 2 : null;
        toggleExpand(shotId);
        renderGrid();
        const clip = grid.querySelector(`.timeline-clip[data-id="${shotId}"]`);
        const cells = clip ? [...clip.querySelectorAll('.tl-expand-cell')] : [];
        if (originCx !== null && cells.length) {
            requestAnimationFrame(() => {
                if (_animToken.get(shotId) !== token) return;
                const startDx = cells.map((cell) => {
                    const r = cell.getBoundingClientRect();
                    return originCx - (r.left + r.width / 2);
                });
                cells.forEach((cell, i) => {
                    cell.style.transition = 'none';
                    cell.style.transform = `translateX(${startDx[i]}px)`;
                });
                void clip.offsetWidth;  // reflow 提交起点
                cells.forEach((cell, i) => {
                    cell.style.transition = `transform 0.5s ${SPRING} ${i * 40}ms`;
                    cell.style.transform = '';
                });
                setTimeout(() => {
                    if (_animToken.get(shotId) !== token) return;
                    cells.forEach((cell) => {
                        cell.style.transition = '';
                        cell.style.transform = '';
                    });
                }, 520 + cells.length * 40);
            });
        }
        focusFirstFrame(shotId);
        return;
    }
    if (state.viewMode === 'list') {
        const token = _nextToken(shotId);
        toggleExpand(shotId);
        renderGrid();
        focusFirstFrame(shotId);
        // Spring-in: 浮层面板从 0 弹入
        // v0.9.2：按 shotId 精确选本镜头的 panel——批量展开时 querySelector('.list-frames')
        // 只取第一个，导致第二个镜头动画作用到第一个的 panel（静默无动画）
        requestAnimationFrame(() => {
            if (_animToken.get(shotId) !== token) return;
            const panel = grid.querySelector(`.shot-card.list-item[data-id="${shotId}"] .list-frames`);
            if (!panel) return;
            panel.style.transformOrigin = 'top left';
            panel.style.transition = 'none';
            panel.style.transform = 'scaleX(0)';panel.style.maxWidth = '0';
            panel.style.opacity = '0';
            void panel.offsetWidth;
            panel.style.transition = 'transform 0.45s ' + SPRING + ', opacity 0.25s ease';
            panel.style.transform = 'scaleX(1)';panel.style.maxWidth = '';
            panel.style.opacity = '1';
            setTimeout(() => {
                if (_animToken.get(shotId) !== token) return;
                panel.style.transition = '';
                panel.style.transformOrigin = '';
            }, 500);
        });
        return;
    }
    const token = _nextToken(shotId);
    const collapsed = grid.querySelector(`.shot-card[data-id="${shotId}"]:not(.frame-cell)`);
    const origin = collapsed ? collapsed.getBoundingClientRect() : null;
    state.animatingShots.add(shotId);
    toggleExpand(shotId);
    renderGrid();
    focusFirstFrame(shotId);
    const cells = _frameCells(shotId);
    if (!origin || cells.length === 0) {
        // 无 origin（如收起动画中途反悔再展开）：清掉残留内联样式，瞬时呈现
        cells.forEach(_clearCellStyle);
        state.animatingShots.delete(shotId);
        return;
    }
    cells.forEach((cell) => {
        const r = cell.getBoundingClientRect();
        const s = origin.width / r.width;
        cell.style.transformOrigin = 'top left';
        cell.style.transition = 'none';
        cell.style.transform = `translate(${origin.left - r.left}px, ${origin.top - r.top}px) scale(${s})`;
        cell.style.opacity = '0.4';
        cell.style.zIndex = '30';
    });
    void grid.offsetWidth;  // 强制 reflow，让起始姿态先生效
    // 分帧播放（v0.9.1 批量展开修复）：起点 transform 必须被浏览器渲染一帧后再清空，
    // 否则 transition 的起点是"上一渲染帧"（批量时 renderGrid 重建后新 cells 已以自然位置
    // 渲染过）→ 从 none 到 none 无过渡 → 该镜头静默无动画（批量第二个镜头必现）
    requestAnimationFrame(() => {
        if (_animToken.get(shotId) !== token) return;
        cells.forEach((cell, i) => {
            const d = i * 40;
            cell.style.transition = `transform 0.5s ${SPRING} ${d}ms, opacity 0.32s ease ${d}ms`;
            cell.style.transform = '';
            cell.style.opacity = '';
        });
        setTimeout(() => {
            if (_animToken.get(shotId) !== token) return;  // 期间又触发了收起，别清
            cells.forEach((cell) => {
                cell.style.transition = '';
                cell.style.transformOrigin = '';
                cell.style.zIndex = '';
            });
            state.animatingShots.delete(shotId);
        }, 500 + (cells.length - 1) * 40 + 80);
    });
}

// 收起：帧格脱离文档流 → renderGrid 立即触发其他卡片 FLIP → 帧格同步飞回封面位置
export function collapseAnimated(shotId) {
    if (state.viewMode === 'timeline') {
        // v0.9.46d：时间线收起改宫格同款时序——帧格 fixed 脱离文档流 → 立即 toggle+renderGrid
        // （其他 clip FLIP / 台词条 FLIP 随子帧图同时开始收回，不再等 380ms 重建；用户实测拍板）
        // → 帧格浮层同步飞回封面格 + 淡出 → 动画结束清理
        const clip = grid.querySelector(`.timeline-clip[data-id="${shotId}"]`);
        const cells = clip ? [...clip.querySelectorAll('.tl-expand-cell')] : [];
        if (cells.length === 0) {
            toggleExpand(shotId); renderGrid(); return;
        }
        const token = _nextToken(shotId);
        state.animatingShots.add(shotId);

        // 1. 帧格脱离文档流（fixed 定位在原地，保留屏幕位置）
        const rects = cells.map(c => c.getBoundingClientRect());
        cells.forEach((cell, i) => {
            const r = rects[i];
            cell.style.position = 'fixed';
            cell.style.left = r.left + 'px';
            cell.style.top = r.top + 'px';
            cell.style.width = r.width + 'px';
            cell.style.margin = '0';
            cell.style.zIndex = String(50 + i);
            cell.style.transformOrigin = 'top left';
            cell.style.transition = 'none';
            cell.style.transform = 'none';
            // v0.9.46e：脱离流后 .timeline-clip .tl-expand-cell 组合选择器全部失效——
            // img 失去 width:100%/aspect-ratio 约束以 320×180 原尺寸渲染（3 张叠成"闪大图"，
            // 用户实测 c0010 折叠时闪现）。inline 样式不依赖选择器，fixed 期间始终生效。
            const im = cell.querySelector('.frame-img');
            if (im) {
                im.style.width = '100%';
                im.style.aspectRatio = '16 / 9';  // v0.9.51：区域比例同步 4:3 → 16:9（与 tlClipH/静态规则一致，防浮层闪变）
                im.style.objectFit = 'contain';
                im.style.objectPosition = 'left center';
                im.style.display = 'block';
                im.style.boxSizing = 'border-box';
            }
            const nm = cell.querySelector('.tl-expand-name');
            if (nm) {
                nm.style.height = '18px';
                nm.style.lineHeight = '18px';
                nm.style.fontSize = '11px';
                nm.style.overflow = 'hidden';
                nm.style.boxSizing = 'border-box';
            }
            document.body.appendChild(cell);
        });

        // 2. 立即 toggle + renderGrid：其他卡片 FLIP 直接开始（宫格同款时序）
        toggleExpand(shotId);
        renderGrid();

        // 3. 帧格同步飞向第一格（封面位置，展开态第一格即封面位），淡出
        const target = rects[0];
        const n = cells.length;
        const totalDuration = 350;  // 收起 0.35s（时间线现状曲线）
        cells.forEach((cell, i) => {
            const r = rects[i];
            const s = target.width / r.width;
            const d = (n - 1 - i) * 30;
            cell.style.transition = `transform ${totalDuration}ms ease-in ${d}ms, opacity ${totalDuration * 0.6}ms ease ${d * 0.8}ms`;
            cell.style.transform = `translate(${target.left - r.left}px, ${target.top - r.top}px) scale(${s})`;
            cell.style.opacity = '0';
        });

        // 4. 动画结束时清理浮层（与最后一张帧格淡出同步）
        const ttl = totalDuration + (n - 1) * 30 + 20;
        setTimeout(() => {
            if (_animToken.get(shotId) !== token) { cells.forEach(c => c.remove()); return; }
            cells.forEach(c => c.remove());
            state.animatingShots.delete(shotId);
        }, ttl);
        return;
    }
    const cells = _frameCells(shotId);
    if (state.viewMode === 'list') {
        // v0.9.2：按 shotId 精确选本镜头的 panel（批量折叠时 querySelector('.list-frames')
        // 只取第一个，第二个镜头动画作用到第一个的 panel）
        const panel = grid.querySelector(`.shot-card.list-item[data-id="${shotId}"] .list-frames`);
        if (panel) {
            panel.style.transformOrigin = 'top left';
            panel.style.transition = 'transform 0.3s ease-in, opacity 0.2s ease';
            panel.style.transform = 'scaleX(0.8)';
            panel.style.opacity = '0';
            setTimeout(() => {
                toggleExpand(shotId);
                renderGrid();
            }, 320);
        }
        return;
    }
    if (cells.length === 0) {
        toggleExpand(shotId); renderGrid(); return;
    }
    const token = _nextToken(shotId);
    state.animatingShots.add(shotId);

    // 1. 记录各帧格当前屏幕位置，然后脱离文档流（absolute 定位在原地）
    const rects = cells.map(c => c.getBoundingClientRect());
    const parent = cells[0].parentNode;
    const scrollY = window.scrollY;
    cells.forEach((cell, i) => {
        const r = rects[i];
        cell.style.position = 'fixed';
        cell.style.left = r.left + 'px';
        cell.style.top = r.top + 'px';
        cell.style.width = r.width + 'px';
        cell.style.margin = '0';
        cell.style.zIndex = String(50 + i);
        cell.style.transformOrigin = 'top left';
        cell.style.transition = 'none';
        cell.style.transform = 'none';
        document.body.appendChild(cell);
    });

    // 2. 立即 toggle + renderGrid：帧格已脱离流，其他卡片 FLIP 直接开始
    // v0.9.30b：折叠不再清 focusedFrameId——折叠态多图封面帧保留焦点框
    //（用户语义：焦点框盖在镜头上；下次展开 focusFirstFrame 会重置，无残留风险）
    toggleExpand(shotId);
    renderGrid();

    // 3. 帧格同步飞向第一格（封面位置），底衬/背景同步淡出
    const target = rects[0];
    const n = cells.length;
    const totalDuration = 380;  // 收拢总时长，比展开略快
    cells.forEach((cell, i) => {
        const r = rects[i];
        const s = target.width / r.width;
        const d = (n - 1 - i) * 30;
        // 底衬背景先开始淡出，与位移同步结束
        cell.style.transition = `transform ${totalDuration}ms ${SPRING} ${d}ms, opacity ${totalDuration * 0.6}ms ease ${d * 0.8}ms`;
        cell.style.transform = `translate(${target.left - r.left}px, ${target.top - r.top}px) scale(${s})`;
        cell.style.opacity = '0';
    });

    // 4. 动画结束时清理浮层（与最后一张帧格淡出同步）
    const ttl = totalDuration + (n - 1) * 30 + 20;
    setTimeout(() => {
        if (_animToken.get(shotId) !== token) { cells.forEach(c => c.remove()); return; }
        cells.forEach(c => c.remove());
        state.animatingShots.delete(shotId);
    }, ttl);
}

// 展开态双击某张图 = 跳回构图（切 Scene + 时间轴跳帧）
export async function jumpToFrame(shotId, frameNo) {
    await postShotAction(shotId, { action: 'jump_to_frame', frame_no: frameNo });
}

// 展开态焦点帧（v0.8.1）：蓝框跟手点击，只动 class 不动 DOM
// v0.9.2：列表视图 frame-thumb 共用同一焦点机制（单焦点，宫格/列表互斥）
export function focusFrame(shotId, frameId) {
    // 全局单选：同一时刻只有一个帧格有焦点框
    state.focusedFrameId = frameId;
    // v0.9.33：清框选择器保留 .shot-thumb 防旧版残留；折叠态封面不再加框
    grid.querySelectorAll('.frame-img.frame-focused, .frame-thumb.frame-focused, .shot-thumb.frame-focused')
        .forEach(el => el.classList.remove('frame-focused'));
    if (frameId) {
        // v0.9.33：加框只匹配展开态帧格（宫格 .frame-cell / 列表 .frame-thumb）——
        // 折叠态（宫格 cover / 列表 shot-thumb）不再有封面内框（用户拍板：
        // 折叠态焦点 = 只有卡片 selected 外框）
        // v0.9.45：时间线展开态帧格同款蓝框（.timeline-clip .frame-img）
        grid.querySelectorAll(`.shot-card.frame-cell[data-id="${shotId}"] .frame-img[data-frame-id="${frameId}"], .shot-card.list-item[data-id="${shotId}"] .frame-thumb[data-frame-id="${frameId}"], .timeline-clip[data-id="${shotId}"] .frame-img[data-frame-id="${frameId}"]`)
            .forEach(el => el.classList.add('frame-focused'));
    }
}

// ---- 悬停横向扫视（折叠态一叠牌）----
// 鼠标 X 坐标在卡片宽度内映射到帧索引：左端=第1张，右端=第N张。
// 即时切换（无渐变），靠预载保证跟手。
// 扫视只在缩略图范围内触发（列表视图文字区不扫视，恢复封面）；移出卡片恢复封面（v0.8.3）
function restoreCover(card) {
    if (card.dataset.hoverOrigSrc === undefined) return;
    // v0.9.62：时间线折叠态多图缩略图是 .tl-clip-thumb（宫格 .frame-stack/.shot-thumb 之外的第三形态）
    const coverImg = card.querySelector('.frame-stack .frame-img.cover') || card.querySelector('.shot-thumb') || card.querySelector('.tl-clip-thumb');
    if (coverImg) {
        coverImg.src = card.dataset.hoverOrigSrc;
        coverImg.dataset.frameId = card.dataset.hoverOrigFrameId || '';
    }
    delete card.dataset.hoverOrigSrc;
    delete card.dataset.hoverOrigFrameId;
}

export function initStackHover() {
    document.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.shot-card.multi:not(.expanded), .list-item.multi:not(.expanded)');
        if (!card) return;
        const shot = state.shots.find(s => s.id === card.dataset.id);
        if (!shot || !shot.frames || shot.frames.length < 2) return;

        // 列表视图：用缩略图范围；宫格视图：用卡片范围
        const thumb = card.classList.contains('list-item')
            ? card.querySelector('.shot-thumb, .frame-img.cover')
            : null;
        const targetEl = thumb || card;
        const rect = targetEl.getBoundingClientRect();
        // 鼠标不在缩略图/卡片范围内：不扫视，恢复封面（列表文字区 hover 不再触发扫视）
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            restoreCover(card);
            return;
        }
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const idx = Math.min(shot.frames.length - 1, Math.floor(ratio * shot.frames.length));
        const frame = shot.frames[idx];
        if (!frame || !frame.imageUrl) return;

        const coverImg = card.querySelector('.frame-stack .frame-img.cover') || card.querySelector('.shot-thumb') || card.querySelector('.tl-clip-thumb');  // v0.9.62：+时间线 .tl-clip-thumb
        if (coverImg && coverImg.dataset.frameId !== frame.id) {
            // 首次扫视：记住原始 src/frameId，鼠标移出时恢复封面（v0.8.3 修复悬停后不回到封面）
            if (card.dataset.hoverOrigSrc === undefined) {
                card.dataset.hoverOrigSrc = coverImg.src;
                // 列表视图 .shot-thumb 无 data-frame-id（undefined），存 '' 避免恢复出 "undefined" 字符串
                card.dataset.hoverOrigFrameId = coverImg.dataset.frameId || '';
            }
            coverImg.src = frame.imageUrl;
            coverImg.dataset.frameId = frame.id;
        }
    });

    // 鼠标移出折叠卡：恢复封面帧（v0.8.3）
    document.addEventListener('mouseout', (e) => {
        const card = e.target.closest('.shot-card.multi:not(.expanded), .list-item.multi:not(.expanded)');
        if (!card) return;
        // 还在卡片内移动（子元素之间），不恢复
        if (card.contains(e.relatedTarget)) return;
        restoreCover(card);
    });
}
